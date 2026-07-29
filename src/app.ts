import express from 'express';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import specRouter from './routes/spec';
import reviewsRouter from './routes/reviews';
import { ErrorEnvelope } from './types';

export function createApp(): express.Application {
  const app = express();

  // ─── Body size limit ──────────────────────────────────────────────────
  // Enforce 1 MiB payload limit BEFORE JSON parsing
  app.use((req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > config.maxPayloadBytes) {
      const error: ErrorEnvelope = {
        error: {
          code: 'payload_too_large',
          message: `Payload exceeds maximum size of ${config.maxPayloadBytes} bytes.`,
        },
      };
      res.status(413).json(error);
      return;
    }
    next();
  });

  // ─── JSON parsing with error handling ─────────────────────────────────
  app.use(
    express.json({
      limit: `${config.maxPayloadBytes}b`,
      strict: false,
    })
  );

  // Handle JSON parse errors
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.type === 'entity.parse.failed') {
      const error: ErrorEnvelope = {
        error: {
          code: 'invalid_json',
          message: 'Request body is not valid JSON.',
        },
      };
      res.status(400).json(error);
      return;
    }
    if (err.type === 'entity.too.large') {
      const error: ErrorEnvelope = {
        error: {
          code: 'payload_too_large',
          message: `Payload exceeds maximum size of ${config.maxPayloadBytes} bytes.`,
        },
      };
      res.status(413).json(error);
      return;
    }
    next(err);
  });

  // ─── Rate limiting (POST /v1/reviews only) ────────────────────────────
  app.use(rateLimiter);

  // ─── Public routes ────────────────────────────────────────────────────
  app.use(healthRouter);
  app.use(specRouter);

  // ─── Auth middleware for /v1/* routes ──────────────────────────────────
  app.use('/v1', authMiddleware);

  // ─── Protected routes ─────────────────────────────────────────────────
  app.use(reviewsRouter);

  // ─── Global error handler ─────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
