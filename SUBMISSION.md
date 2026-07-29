# SUBMISSION

## Deployment

The service is deployed live on **Railway**. Server environment variables (`BEARER_TOKEN`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, and `PORT`) are configured via Railway's dashboard.

## Architecture

Express HTTP service running on Railway with in-memory state. The pipeline is:
**HTTP → Auth → Rate Limiter → Job Manager → Diff Parser → Chunker → Provider → Cache → SSE Events**

Jobs are processed asynchronously via a bounded concurrency pool (max 4 active, overflow queued). All state (jobs, cache, events, idempotency keys) is held in memory — suitable for the 48-hour scoring window; a production version would use Redis/Postgres.

## Provider Design

Both providers implement a shared `ReviewProvider` interface (`analyze(files, options) → Finding[]`). The **mock** provider applies 9 deterministic regex/pattern rules against added lines. The **LLM** provider sends diff content to an OpenAI-compatible API and parses structured JSON findings from the response. If the LLM is unreachable, the job transitions to `failed` with a descriptive error — no crash, no 5xx.

## Verification of Cross-Cutting Behaviors

- **Mock rules:** Test script submits diffs triggering each rule (eval, api_key, SQL concat, empty catch, == null, JSON.parse(JSON.stringify(, console.log, TODO/FIXME, injection phrases) and verifies exact finding output.
- **Chunking:** Tested with diffs exceeding 64 KiB, verified chunk count in `usage.chunks` and finding consistency vs. small diffs.
- **Caching:** Submit identical diff twice → second job reports `cacheHit: true` with identical findings.
- **Idempotency:** Same `Idempotency-Key` + same body → same `jobId`. Same key + different body → 409.
- **SSE replay:** Connect to a finished job's `/stream` → all events replayed in order, ending with `done`.
- **Rate limiting:** Burst test confirms 30 requests succeed; request 31 returns 429 with `Retry-After`.
- **Concurrency:** 5 simultaneous submissions → 4 process in parallel, 5th queues and eventually completes.

## AI Tools Used

- **Claude (Antigravity IDE):** Used for generating the initial implementation plan, scaffolding all source files, writing the test script, and iterating on TypeScript type issues.

## AI Suggestion Rejected

The AI initially suggested using a third-party rate limiting library (`express-rate-limit`). I rejected this because the spec requires a token bucket with specific burst semantics and a `Retry-After` header, which is simpler to implement correctly in ~40 lines than to configure via a generic library. Additionally, fewer dependencies means a smaller attack surface and easier auditability.

## What I'd Do Next

1. **Persistent storage** — Redis for cache/idempotency/jobs, PostgreSQL for audit trail
2. **Structured logging** — JSON logs with correlation IDs per request/job
3. **Comprehensive test suite** — Vitest with edge cases for each mock rule, chunk boundary conditions, and concurrent stress tests
4. **Dockerfile + CI/CD** — Docker build, GitHub Actions for lint/test/deploy
5. **Graceful shutdown** — Drain in-flight jobs on SIGTERM before exiting
6. **Observability** — Prometheus metrics for job latency, cache hit rate, error rates
