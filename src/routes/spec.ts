import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

/**
 * GET /spec — public machine-readable self-declaration.
 * Declared limits must match actual behavior.
 */
router.get('/spec', (_req: Request, res: Response) => {
  res.status(200).json({
    specVersion: '1.0',
    providers: ['mock', 'llm'],
    limits: {
      maxPayloadBytes: config.maxPayloadBytes,
      chunkBytes: config.chunkBytes,
      maxConcurrentJobs: config.maxConcurrentJobs,
      rateLimitPerMinute: config.rateLimitPerMinute,
    },
  });
});

export default router;
