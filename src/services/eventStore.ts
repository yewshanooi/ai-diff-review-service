import { SSEEvent } from '../types';

/**
 * In-memory store for SSE events per job.
 * Enables full replay when connecting to a finished job's stream.
 */
class EventStore {
  private events: Map<string, SSEEvent[]> = new Map();

  /**
   * Append an event for a job.
   */
  push(jobId: string, event: SSEEvent): void {
    if (!this.events.has(jobId)) {
      this.events.set(jobId, []);
    }
    this.events.get(jobId)!.push(event);
  }

  /**
   * Get all stored events for a job.
   */
  getAll(jobId: string): SSEEvent[] {
    return this.events.get(jobId) || [];
  }

  /**
   * Check if a job has any events stored.
   */
  has(jobId: string): boolean {
    return this.events.has(jobId);
  }
}

export const eventStore = new EventStore();
