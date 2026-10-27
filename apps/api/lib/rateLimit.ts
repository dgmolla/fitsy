import { NextResponse } from 'next/server';
import { consumeSharedQuota } from '@/services/rateLimitStore';

/** Shared sliding windows in deployments; bounded local windows for offline dev. */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
  unavailable?: boolean;
}

export interface RateLimiterOptions {
  /** Stable, unique quota name shared by every API instance. */
  namespace: string;
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
  let nextWarningAt = 0;
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(opts.namespace)
    || !Number.isSafeInteger(opts.windowMs) || opts.windowMs < 1 || opts.windowMs > 86_400_000
    || !Number.isSafeInteger(opts.max) || opts.max < 1 || opts.max > 1_000
    || !Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 10_000) {
    throw new Error('Invalid rate limiter policy');
  }

  function checkLocal(key: string): RateLimitResult {
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

  async function check(key: string): Promise<RateLimitResult> {
    const deployed = process.env['VERCEL'] === '1' || ['production', 'preview'].includes(process.env['VERCEL_ENV'] ?? '')
      || process.env['NODE_ENV'] === 'production';
    if (!deployed && !process.env['UPSTASH_REDIS_REST_URL'] && !process.env['UPSTASH_REDIS_REST_TOKEN']) {
      return checkLocal(key);
    }
    try {
      return await consumeSharedQuota({ ...opts, maxKeys }, key);
    } catch {
      // Do not log credentials, IPs, user IDs or provider bodies. Bound outage logs.
      if (Date.now() >= nextWarningAt) {
        console.error(`[rate-limit] Shared store unavailable (${opts.namespace}); requests fail closed`);
        nextWarningAt = Date.now() + 60_000;
      }
      return { ok: false, unavailable: true, remaining: 0, retryAfterMs: 1_000 };
    }
  }

  return { check };
}

/** Every denial is private, has an integer Retry-After, and distinguishes outages. */
export function rateLimitResponse(result: RateLimitResult, message = 'Too many requests'): NextResponse<{ error: string }> {
  return NextResponse.json({ error: result.unavailable ? 'Service unavailable' : message }, {
    status: result.unavailable ? 503 : 429,
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))), 'Cache-Control': 'private, no-store' },
  });
}

// ─── Shared limiters ──────────────────────────────────────────────────────────

/**
 * Auth endpoints: 10 attempts per IP per minute.
 * Covers both login (brute-force) and register (account spam).
 */
export const authLimiter = createRateLimiter({ namespace: 'auth', windowMs: 60_000, max: 10 });

/** Shared across all data routes, including subscription and preview reads. */
export const dataIpLimiter = createRateLimiter({ namespace: 'data-ip', windowMs: 60_000, max: 300 });
export const dataUserLimiter = createRateLimiter({ namespace: 'data-user', windowMs: 60_000, max: 120 });

/**
 * Feedback endpoint: 5 submissions per user per 5 minutes.
 * Deters spamming the team inbox while leaving room for genuine follow-ups.
 */
export const feedbackLimiter = createRateLimiter({ namespace: 'feedback-user', windowMs: 300_000, max: 5 });

/**
 * Public website waitlist form: 5 signups per IP per 10 minutes.
 * The form is unauthenticated, so this is the only brake on list-stuffing.
 */
export const waitlistLimiter = createRateLimiter({ namespace: 'waitlist-ip', windowMs: 600_000, max: 5 });
