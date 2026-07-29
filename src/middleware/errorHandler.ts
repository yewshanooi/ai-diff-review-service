import { Request, Response, NextFunction } from 'express';
import { ErrorEnvelope } from '../types';

/**
 * Global error handler — catches uncaught errors and returns the error envelope.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err);

  const error: ErrorEnvelope = {
    error: {
      code: 'internal',
      message: err.message || 'Internal server error',
    },
  };
  res.status(500).json(error);
}
