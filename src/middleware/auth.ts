import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { ErrorEnvelope } from '../types';

/**
 * Middleware to enforce Bearer token authentication on /v1/* routes.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const error: ErrorEnvelope = {
      error: {
        code: 'unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
      },
    };
    res.status(401).json(error);
    return;
  }

  const token = authHeader.substring(7);
  if (token !== config.bearerToken) {
    const error: ErrorEnvelope = {
      error: {
        code: 'unauthorized',
        message: 'Invalid bearer token',
      },
    };
    res.status(401).json(error);
    return;
  }

  next();
}
