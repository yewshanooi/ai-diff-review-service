# AI Diff Review Service

An asynchronous HTTP service that analyzes unified diffs and returns structured code review findings. Supports both a deterministic **mock** provider and a real **LLM** provider.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env

# Build
npx tsc

# Start
node dist/index.js
```

## Configuration

All configuration is via `.env` file:

| Variable | Default | Description |
|---|---|---|
| `BEARER_TOKEN` | `default-token` | Token for authenticating `/v1/*` routes |
| `PORT` | `3000` | HTTP port |
| `LLM_API_KEY` | *(empty)* | Gemini API key (or compatible) |
| `LLM_MODEL` | `gemini-3.6-flash` | Model to use for the LLM provider |
| `LLM_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/` | Base URL for the LLM API |

## API Endpoints

### Public

- `GET /health` → `{ status, version, uptimeSeconds }`
- `GET /spec` → `{ specVersion, providers, limits }`

### Authenticated (`Authorization: Bearer <token>`)

- `POST /v1/reviews` → Submit a diff for review (returns 202 + jobId)
- `GET /v1/reviews/:jobId` → Poll job status and results
- `GET /v1/reviews/:jobId/stream` → SSE event stream (with full replay)

## Providers

### `mock` (default)
Deterministic rule-based analysis. Detects:
- `MOCK-001` — eval usage
- `MOCK-002` — hardcoded secrets (api_key patterns)
- `MOCK-003` — SQL string concatenation
- `MOCK-004` — swallowed exceptions (empty catch blocks)
- `MOCK-005` — loose null comparison (`== null` / `!= null`)
- `MOCK-006` — deep-clone via JSON
- `MOCK-007` — console.log left in code
- `MOCK-008` — unresolved TODO/FIXME markers
- `MOCK-INJ` — prompt injection content

### `llm`
Real LLM-powered code review via OpenAI-compatible API. Requires `LLM_API_KEY` to be set. Supports OpenAI, Google AI Studio, Groq, or local LLMs via Ollama. If the model is unreachable, the job fails gracefully with a clear error message.

#### Google AI Studio Configuration
To use Gemini via Google AI Studio, set the following in `.env`:
```env
LLM_API_KEY=your-gemini-api-key
LLM_MODEL=gemini-3.6-flash
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
```

## Cross-Cutting Behaviors

- **Chunking:** Diffs over 64 KiB are split on file boundaries
- **Caching:** Byte-identical `{diff, options}` returns cached results (`cacheHit: true`)
- **Idempotency:** `Idempotency-Key` header ensures same key + same body = same jobId
- **Rate Limiting:** Token bucket at 30 req/min on POST /v1/reviews
- **Concurrency:** Up to 4 jobs processed simultaneously; overflow is queued
- **SSE Replay:** Connecting to a finished job's stream replays all events

## Testing

```bash
node test.mjs
```

## Project Structure

```
src/
├── index.ts              # Entry point
├── app.ts                # Express app setup
├── config.ts             # Configuration
├── types.ts              # TypeScript types
├── middleware/
│   ├── auth.ts           # Bearer token auth
│   ├── rateLimiter.ts    # Token bucket rate limiter
│   └── errorHandler.ts   # Global error handler
├── routes/
│   ├── health.ts         # GET /health
│   ├── spec.ts           # GET /spec
│   └── reviews.ts        # /v1/reviews routes + SSE
├── services/
│   ├── jobManager.ts     # Job lifecycle & concurrency
│   ├── diffParser.ts     # Unified diff parser
│   ├── chunker.ts        # Diff chunking
│   ├── cache.ts          # SHA-256 result cache
│   └── eventStore.ts     # SSE event storage
└── providers/
    ├── index.ts           # Provider registry
    ├── mock.ts            # Deterministic mock rules
    └── llm.ts             # OpenAI-compatible LLM
```
