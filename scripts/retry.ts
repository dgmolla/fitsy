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
  /**
   * Optional per-attempt delay override. Return a positive number of ms to
   * use that delay (e.g., parsed from a `retry-after` header), or null to
   * fall through to the default `backoffMs` schedule. Called once per
   * retry, with the caught error and zero-based attempt index.
   */
  computeDelayMs?: (error: unknown, attempt: number) => number | null;
  /**
   * Jitter fraction applied to the final delay: final = delay ± delay*jitter.
   * Prevents thundering-herd when many concurrent callers retry together.
   * Default 0.3 (±30%). Set 0 to disable.
   */
  jitter?: number;
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
    computeDelayMs,
    jitter = 0.3,
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

      const override = computeDelayMs?.(err, attempt) ?? null;
      const baseDelay =
        override !== null && override > 0
          ? override
          : (backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 3000);
      const jitterRange = baseDelay * Math.max(0, jitter);
      const delayMs = Math.max(
        0,
        Math.round(baseDelay + (Math.random() * 2 - 1) * jitterRange),
      );
      const suffix = override !== null && override > 0 ? " (server retry-after)" : "";
      console.warn(
        `[retry] ${label} attempt ${attempt + 1} failed, retrying in ${delayMs}ms${suffix}: ${String(err)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
