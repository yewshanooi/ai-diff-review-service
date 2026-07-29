import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { ErrorEnvelope } from '../types';

/**
 * Token bucket rate limiter for POST /v1/reviews.
 * Allows sustained rateLimitPerMinute requests, with burst support.
 */
class TokenBucket {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms
  private lastRefill: number;

  constructor(maxTokens: number, refillRatePerMinute: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerMinute / 60_000; // convert per-minute to per-ms
    this.lastRefill = Date.now();
  }

  tryConsume(): { allowed: boolean; retryAfterSeconds?: number } {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true };
    }

    // Calculate time until next token is available
    const timeUntilToken = (1 - this.tokens) / this.refillRate;
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(timeUntilToken / 1000),
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

const bucket = new TokenBucket(config.rateLimitPerMinute, config.rateLimitPerMinute);

/**
 * Rate limiting middleware for POST /v1/reviews only.
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  // Only rate limit POST /v1/reviews
  if (req.method !== 'POST' || req.path !== '/v1/reviews') {
    next();
    return;
  }

  const result = bucket.tryConsume();
  if (!result.allowed) {
    res.set('Retry-After', String(result.retryAfterSeconds));
    const error: ErrorEnvelope = {
      error: {
        code: 'rate_limited',
        message: `Rate limit exceeded. Retry after ${result.retryAfterSeconds} seconds.`,
      },
    };
    res.status(429).json(error);
    return;
  }

  next();
}
