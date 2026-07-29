import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

/**
 * GET /health — public health check endpoint.
 */
router.get('/health', (_req: Request, res: Response) => {
  const uptimeSeconds = Math.floor((Date.now() - config.startTime) / 1000);

  res.status(200).json({
    status: 'ok',
    version: '1.0.0',
    uptimeSeconds,
  });
});

export default router;
