/**
 * Generic retry utility with exponential backoff for the pipeline.
 *
 * Used by: UE fetch, Haiku calls, Firecrawl scrape (S-116).
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;
  /** Backoff delays in ms for each retry (default: [1000, 3000]) */
  backoffMs?: number[];
  /** Whether to retry on this error (default: always retry) */
  shouldRetry?: (error: unknown) => boolean;
  /** Label for logging */
  label?: string;
}

export interface RetryResult<T> {
  result: T;
  retriesAttempted: number;
}

/**
 * Retry a function with exponential backoff.
 *
 * Throws the last error if all attempts fail.
 * Returns the result and number of retries attempted on success.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const {
    maxRetries = 2,
    backoffMs = [1000, 3000],
    shouldRetry = () => true,
    label = "operation",
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retriesAttempted: attempt };
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !shouldRetry(err)) {
        throw err;
      }

      const delayMs = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 3000;
      console.warn(
        `[retry] ${label} attempt ${attempt + 1} failed, retrying in ${delayMs}ms: ${String(err)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
