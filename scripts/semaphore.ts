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

  /**
   * Run a function with timing split between semaphore-wait and actual work.
   * Use when profiling to distinguish "API is slow" from "we're queueing on the sem".
   */
  async runTimed<T>(fn: () => Promise<T>): Promise<{ result: T; acquireMs: number; workMs: number }> {
    const t0 = Date.now();
    await this.acquire();
    const acquireMs = Date.now() - t0;
    const t1 = Date.now();
    try {
      const result = await fn();
      return { result, acquireMs, workMs: Date.now() - t1 };
    } finally {
      this.release();
    }
  }
}

/**
 * Per-API semaphore limits:
 * - UE fetch: 5 concurrent, 500ms delay (delay handled in uberEatsSource)
 * - Haiku: 40 concurrent (Tier 2 Anthropic; safe headroom vs batch
 *   size of CONFIG.concurrency=20 in preload-ue-first.ts)
 * - Brave Search: 15 concurrent
 * - Firecrawl: 3 concurrent
 */
export const API_SEMAPHORES = {
  ubereats: new Semaphore(5),
  haiku: new Semaphore(40),
  braveSearch: new Semaphore(15),
  firecrawl: new Semaphore(3),
};
