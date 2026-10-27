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
  /** Bound memory even when callers rotate IPs or accounts. */
  maxKeys?: number;
}

interface Entry {
  timestamps: number[];
  expiresAt: number;
}

export function createRateLimiter(opts: RateLimiterOptions) {
  const store = new Map<string, Entry>();
  const maxKeys = opts.maxKeys ?? 10_000;
  let nextSweepAt = 0;

  function check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    if (now >= nextSweepAt) {
      for (const [storedKey, entry] of store) {
        if (entry.expiresAt <= now) store.delete(storedKey);
      }
      nextSweepAt = now + opts.windowMs;
    }

    let entry = store.get(key);
    if (!entry) {
      // Do not evict live buckets: rotating identities must not reset quotas.
      if (store.size >= maxKeys) return { ok: false, remaining: 0, retryAfterMs: opts.windowMs };
      entry = { timestamps: [], expiresAt: now + opts.windowMs };
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
    entry.expiresAt = now + opts.windowMs;
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

/** Shared across all data routes, including subscription and preview reads. */
export const dataIpLimiter = createRateLimiter({ windowMs: 60_000, max: 300 });
export const dataUserLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

/**
 * Feedback endpoint: 5 submissions per user per 5 minutes.
 * Deters spamming the team inbox while leaving room for genuine follow-ups.
 */
export const feedbackLimiter = createRateLimiter({ windowMs: 300_000, max: 5 });

/**
 * Public website waitlist form: 5 signups per IP per 10 minutes.
 * The form is unauthenticated, so this is the only brake on list-stuffing.
 */
export const waitlistLimiter = createRateLimiter({ windowMs: 600_000, max: 5 });
