// ─── Finding ────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category = 'security' | 'correctness' | 'performance' | 'style';

export interface Finding {
  id: string;        // e.g. "MOCK-003:src/db.ts:41"
  ruleId: string;
  path: string;
  line: number;
  severity: Severity;
  category: Category;
  title: string;
  evidence: string;  // the offending added line, verbatim
}

// ─── Job ────────────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobUsage {
  inputBytes: number;
  chunks: number;
  cacheHit: boolean;
}

export interface Job {
  jobId: string;
  status: JobStatus;
  findings: Finding[];
  usage: JobUsage;
  error?: string;
  diff: string;
  options: ReviewOptions;
  createdAt: number;
}

// ─── Review request ─────────────────────────────────────────────────────────

export interface ReviewOptions {
  provider: 'mock' | 'llm';
  maxFindings: number;
}

export interface ReviewRequest {
  diff: string;
  options?: {
    provider?: 'mock' | 'llm';
    maxFindings?: number;
  };
}

// ─── SSE Events ─────────────────────────────────────────────────────────────

export interface SSEEvent {
  event: 'status' | 'finding' | 'done';
  data: any;
}

// ─── Diff parsing ───────────────────────────────────────────────────────────

export interface ParsedAddedLine {
  path: string;
  line: number;       // line number in the new file
  content: string;    // the full line content (without the leading +)
}

export interface ParsedFile {
  path: string;
  addedLines: ParsedAddedLine[];
  rawContent: string; // raw diff content for this file
}

// ─── Provider interface ─────────────────────────────────────────────────────

export interface ReviewProvider {
  name: string;
  analyze(files: ParsedFile[], options: ReviewOptions): Promise<Finding[]>;
}

// ─── Error envelope ─────────────────────────────────────────────────────────

export type ErrorCode =
  | 'unauthorized'
  | 'payload_too_large'
  | 'invalid_json'
  | 'invalid_diff'
  | 'idempotency_conflict'
  | 'not_found'
  | 'rate_limited'
  | 'internal';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
  };
}
