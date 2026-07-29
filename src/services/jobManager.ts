import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Job, JobStatus, ReviewOptions, Finding, SSEEvent } from '../types';
import { parseDiff } from './diffParser';
import { chunkFiles } from './chunker';
import { getProvider } from '../providers';
import { reviewCache } from './cache';
import { eventStore } from './eventStore';
import { config } from '../config';
import crypto from 'crypto';

/**
 * JobManager handles the full lifecycle of review jobs:
 *  - Creation and queuing
 *  - Concurrent processing (up to maxConcurrentJobs)
 *  - Caching and idempotency
 *  - SSE event emission
 */
class JobManager extends EventEmitter {
  private jobs: Map<string, Job> = new Map();
  private idempotencyMap: Map<string, { bodyHash: string; jobId: string }> = new Map();
  private activeJobs = 0;
  private queue: string[] = [];

  /**
   * Create a new review job.
   * Returns { jobId, status, fromCache, idempotencyConflict }.
   */
  createJob(
    diff: string,
    options: ReviewOptions,
    idempotencyKey?: string,
    bodyRaw?: string
  ): { jobId: string; status: JobStatus; error?: string } {
    // Handle idempotency
    if (idempotencyKey) {
      const bodyHash = crypto
        .createHash('sha256')
        .update(bodyRaw || JSON.stringify({ diff, options }))
        .digest('hex');
      const existing = this.idempotencyMap.get(idempotencyKey);

      if (existing) {
        if (existing.bodyHash === bodyHash) {
          // Same key + same body → return existing jobId
          const job = this.jobs.get(existing.jobId)!;
          return { jobId: job.jobId, status: job.status };
        } else {
          // Same key + different body → conflict
          return { jobId: '', status: 'failed', error: 'idempotency_conflict' };
        }
      }

      // Register idempotency key
      const jobId = uuidv4();
      this.idempotencyMap.set(idempotencyKey, { bodyHash, jobId });
      return this._createAndQueueJob(jobId, diff, options);
    }

    const jobId = uuidv4();
    return this._createAndQueueJob(jobId, diff, options);
  }

  private _createAndQueueJob(
    jobId: string,
    diff: string,
    options: ReviewOptions
  ): { jobId: string; status: JobStatus } {
    const job: Job = {
      jobId,
      status: 'queued',
      findings: [],
      usage: {
        inputBytes: Buffer.byteLength(diff, 'utf-8'),
        chunks: 0,
        cacheHit: false,
      },
      diff,
      options,
      createdAt: Date.now(),
    };

    this.jobs.set(jobId, job);

    // Emit initial SSE event
    const statusEvent: SSEEvent = {
      event: 'status',
      data: { jobId, status: 'queued' },
    };
    eventStore.push(jobId, statusEvent);
    this.emit(`job:${jobId}`, statusEvent);

    // Try to process immediately or queue
    this._tryProcess(jobId);

    return { jobId, status: 'queued' };
  }

  private _tryProcess(jobId: string): void {
    if (this.activeJobs < config.maxConcurrentJobs) {
      this.activeJobs++;
      this._processJob(jobId).catch((err) => {
        console.error(`Job ${jobId} failed unexpectedly:`, err);
      });
    } else {
      this.queue.push(jobId);
    }
  }

  private async _processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      this.activeJobs--;
      this._processNext();
      return;
    }

    try {
      // Transition to running
      job.status = 'running';
      const runningEvent: SSEEvent = {
        event: 'status',
        data: { jobId, status: 'running' },
      };
      eventStore.push(jobId, runningEvent);
      this.emit(`job:${jobId}`, runningEvent);

      // Check cache
      const cacheKey = reviewCache.computeKey(job.diff, {
        provider: job.options.provider,
        maxFindings: job.options.maxFindings,
      });

      const cached = reviewCache.get(cacheKey);
      if (cached) {
        job.findings = cached.findings;
        job.usage = { ...cached.usage, cacheHit: true };
        job.status = 'done';

        // Emit findings
        for (const finding of job.findings) {
          const findingEvent: SSEEvent = {
            event: 'finding',
            data: finding,
          };
          eventStore.push(jobId, findingEvent);
          this.emit(`job:${jobId}`, findingEvent);
        }

        // Emit done
        const doneEvent: SSEEvent = {
          event: 'done',
          data: { total: job.findings.length, usage: job.usage },
        };
        eventStore.push(jobId, doneEvent);
        this.emit(`job:${jobId}`, doneEvent);

        this.activeJobs--;
        this._processNext();
        return;
      }

      // Parse diff
      const files = parseDiff(job.diff);

      // Chunk if needed
      const chunks = chunkFiles(files);
      job.usage.chunks = chunks.length;

      // Get provider
      const provider = getProvider(job.options.provider);
      if (!provider) {
        throw new Error(`Unknown provider: ${job.options.provider}`);
      }

      // Process each chunk and collect findings
      const allFindings: Finding[] = [];
      for (const chunk of chunks) {
        const chunkFindings = await provider.analyze(chunk, job.options);
        allFindings.push(...chunkFindings);
      }

      // Deduplicate and sort across all chunks
      const seen = new Set<string>();
      const dedupedFindings = allFindings.filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });

      // Sort: path (lexicographic), line (ascending), ruleId
      dedupedFindings.sort((a, b) => {
        if (a.path !== b.path) return a.path < b.path ? -1 : 1;
        if (a.line !== b.line) return a.line - b.line;
        return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
      });

      // Apply maxFindings truncation (but usage reflects full scan)
      const truncatedFindings = dedupedFindings.slice(0, job.options.maxFindings);
      job.findings = truncatedFindings;
      job.status = 'done';

      // Cache the result (store truncated findings and usage)
      reviewCache.set(cacheKey, {
        findings: truncatedFindings,
        usage: { ...job.usage },
      });

      // Emit each finding as SSE event
      for (const finding of job.findings) {
        const findingEvent: SSEEvent = {
          event: 'finding',
          data: finding,
        };
        eventStore.push(jobId, findingEvent);
        this.emit(`job:${jobId}`, findingEvent);
      }

      // Emit done event
      const doneEvent: SSEEvent = {
        event: 'done',
        data: { total: job.findings.length, usage: job.usage },
      };
      eventStore.push(jobId, doneEvent);
      this.emit(`job:${jobId}`, doneEvent);
    } catch (error: any) {
      job.status = 'failed';
      job.error = error?.message || 'Internal processing error';

      // Emit failed status
      const failedEvent: SSEEvent = {
        event: 'status',
        data: { jobId, status: 'failed', error: job.error },
      };
      eventStore.push(jobId, failedEvent);
      this.emit(`job:${jobId}`, failedEvent);

      // Emit done event even on failure
      const doneEvent: SSEEvent = {
        event: 'done',
        data: { total: 0, usage: job.usage, error: job.error },
      };
      eventStore.push(jobId, doneEvent);
      this.emit(`job:${jobId}`, doneEvent);
    }

    this.activeJobs--;
    this._processNext();
  }

  private _processNext(): void {
    while (this.queue.length > 0 && this.activeJobs < config.maxConcurrentJobs) {
      const nextJobId = this.queue.shift()!;
      this.activeJobs++;
      this._processJob(nextJobId).catch((err) => {
        console.error(`Queued job failed unexpectedly:`, err);
      });
    }
  }

  /**
   * Get a job by ID.
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }
}

export const jobManager = new JobManager();
