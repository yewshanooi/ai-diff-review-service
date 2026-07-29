import { Router, Request, Response } from 'express';
import { jobManager } from '../services/jobManager';
import { eventStore } from '../services/eventStore';
import { isValidDiff } from '../services/diffParser';
import { config } from '../config';
import { ErrorEnvelope, ReviewOptions } from '../types';

const router = Router();

/**
 * POST /v1/reviews — create a new review job.
 */
router.post('/v1/reviews', (req: Request, res: Response) => {
  const body = req.body;

  // Validate request body exists and is an object
  if (!body || typeof body !== 'object') {
    const error: ErrorEnvelope = {
      error: {
        code: 'invalid_json',
        message: 'Request body must be a valid JSON object.',
      },
    };
    res.status(400).json(error);
    return;
  }

  // Validate diff field exists and is a non-empty string
  if (!body.diff || typeof body.diff !== 'string' || body.diff.trim() === '') {
    const error: ErrorEnvelope = {
      error: {
        code: 'invalid_diff',
        message: 'The "diff" field is required and must be a non-empty string containing a valid unified diff.',
      },
    };
    res.status(422).json(error);
    return;
  }

  // Validate diff is parseable as unified diff
  if (!isValidDiff(body.diff)) {
    const error: ErrorEnvelope = {
      error: {
        code: 'invalid_diff',
        message: 'The "diff" field could not be parsed as a valid unified diff.',
      },
    };
    res.status(422).json(error);
    return;
  }

  // Build options with defaults
  const options: ReviewOptions = {
    provider: body.options?.provider || 'mock',
    maxFindings: body.options?.maxFindings ?? 100,
  };

  // Validate provider
  if (options.provider !== 'mock' && options.provider !== 'llm') {
    const error: ErrorEnvelope = {
      error: {
        code: 'invalid_diff',
        message: `Unknown provider "${options.provider}". Supported: mock, llm.`,
      },
    };
    res.status(422).json(error);
    return;
  }

  // Get idempotency key from header safely
  const rawIdempotencyKey = req.headers['idempotency-key'];
  const idempotencyKey = Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey;

  // Get the raw body string for idempotency hashing
  const bodyRaw = JSON.stringify(body);

  // Create the job
  const result = jobManager.createJob(body.diff, options, idempotencyKey, bodyRaw);

  // Handle idempotency conflict
  if (result.error === 'idempotency_conflict') {
    const error: ErrorEnvelope = {
      error: {
        code: 'idempotency_conflict',
        message: 'The Idempotency-Key has already been used with a different request body.',
      },
    };
    res.status(409).json(error);
    return;
  }

  res.status(202).json({
    jobId: result.jobId,
    status: result.status,
  });
});

/**
 * GET /v1/reviews/:jobId — get job status and results.
 */
router.get('/v1/reviews/:jobId', (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = jobManager.getJob(jobId);

  if (!job) {
    const error: ErrorEnvelope = {
      error: {
        code: 'not_found',
        message: `Job "${jobId}" not found.`,
      },
    };
    res.status(404).json(error);
    return;
  }

  const response: any = {
    jobId: job.jobId,
    status: job.status,
    usage: job.usage,
  };

  if (job.status === 'done') {
    response.findings = job.findings;
  }

  if (job.status === 'failed') {
    response.findings = [];
    response.error = job.error;
  }

  res.status(200).json(response);
});

/**
 * GET /v1/reviews/:jobId/stream — SSE event stream.
 */
router.get('/v1/reviews/:jobId/stream', (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const job = jobManager.getJob(jobId);

  if (!job) {
    const error: ErrorEnvelope = {
      error: {
        code: 'not_found',
        message: `Job "${jobId}" not found.`,
      },
    };
    res.status(404).json(error);
    return;
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Helper to write an SSE event
  const writeEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // If job is already done/failed, replay all events and close
  if (job.status === 'done' || job.status === 'failed') {
    const events = eventStore.getAll(jobId);
    for (const evt of events) {
      writeEvent(evt.event, evt.data);
    }
    res.end();
    return;
  }

  // Job is still in progress — replay existing events first, then stream new ones
  const existingEvents = eventStore.getAll(jobId);
  for (const evt of existingEvents) {
    writeEvent(evt.event, evt.data);
  }

  // Listen for new events
  const listener = (evt: { event: string; data: any }) => {
    writeEvent(evt.event, evt.data);

    // Close the stream after done event
    if (evt.event === 'done') {
      jobManager.removeListener(`job:${jobId}`, listener);
      res.end();
    }
  };

  jobManager.on(`job:${jobId}`, listener);

  // Clean up if client disconnects
  req.on('close', () => {
    jobManager.removeListener(`job:${jobId}`, listener);
  });
});

export default router;
