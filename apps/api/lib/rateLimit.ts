/**
 * In-process sliding-window rate limiter.
 *
 * Limitations: per-instance (resets on serverless cold starts, no cross-instance
 * sharing). Good enough as a deterrent for MVP; replace with Upstash Redis for
 * production hardening (SEC-02b).
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });
 *   const result = limiter.check(ip);
 *   if (!result.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiterOptions {
  /** Rolling window size in milliseconds */
  windowMs: number;
  /** Maximum requests allowed within the window */
  max: number;
}

interface Entry {
  timestamps: number[];
}

export function createRateLimiter(opts: RateLimiterOptions) {
  const store = new Map<string, Entry>();

  function check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Evict timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= opts.max) {
      const oldest = entry.timestamps[0]!;
      const retryAfterMs = oldest + opts.windowMs - now;
      return { ok: false, remaining: 0, retryAfterMs };
    }

    entry.timestamps.push(now);
    return {
      ok: true,
      remaining: opts.max - entry.timestamps.length,
      retryAfterMs: 0,
    };
  }

  return { check };
}

// ─── Shared limiters ──────────────────────────────────────────────────────────

/**
 * Auth endpoints: 10 attempts per IP per minute.
 * Covers both login (brute-force) and register (account spam).
 */
export const authLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

/**
 * Feedback endpoint: 5 submissions per user per 5 minutes.
 * Deters spamming the team inbox while leaving room for genuine follow-ups.
 */
export const feedbackLimiter = createRateLimiter({ windowMs: 300_000, max: 5 });
