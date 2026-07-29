import crypto from 'crypto';
import { Finding, JobUsage } from '../types';

interface CacheEntry {
  findings: Finding[];
  usage: JobUsage;
}

/**
 * Cache for review results keyed by SHA-256 hash of {diff, options}.
 * A byte-identical {diff, options} must not redo work.
 */
class ReviewCache {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * Compute a deterministic cache key from diff and options.
   */
  computeKey(diff: string, options: { provider: string; maxFindings: number }): string {
    const payload = JSON.stringify({ diff, options });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Get cached result, or undefined if not cached.
   */
  get(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }

  /**
   * Store a result in the cache.
   */
  set(key: string, entry: CacheEntry): void {
    this.cache.set(key, entry);
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }
}

export const reviewCache = new ReviewCache();
