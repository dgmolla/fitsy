/**
 * Semaphore for Per-API Concurrency Limits (S-128)
 *
 * Limits concurrent access to external APIs to respect rate limits.
 * Each API gets its own semaphore with a configured concurrency cap.
 */

export class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }

  /**
   * Run a function with the semaphore held.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Per-API semaphore limits from the spec:
 * - UE fetch: 5 concurrent, 500ms delay (delay handled in uberEatsSource)
 * - Haiku: 20 concurrent
 * - Brave Search: 15 concurrent
 * - Firecrawl: 3 concurrent
 */
export const API_SEMAPHORES = {
  ubereats: new Semaphore(5),
  haiku: new Semaphore(20),
  braveSearch: new Semaphore(15),
  firecrawl: new Semaphore(3),
};
