import type { PrismaClient } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import type { UeRequestLimiter } from '../../apps/api/services/menuSources/ueApiClient';

type Database = Pick<PrismaClient, '$queryRaw'>;
export interface UeRateState {
  capRps: number; effectiveRps: number; nextRequestAt: Date; blockedUntil: Date;
  requests: bigint; waits: bigint; throttles: bigint;
}
export interface UeThrottleEvent {
  event: 'ue_throttle'; status: 403 | 429; capRps: number; effectiveRps: number;
  blockedUntil: string; throttles: string;
}

export function validateUeRate(capRps: number): number {
  if (!Number.isFinite(capRps) || capRps < 0.01 || capRps > 10) throw new Error('UE rate must be 0.01-10 requests per second');
  return capRps;
}
export function parseUeRateOptions(args: string[]): number | undefined {
  if (args[0] !== 'ue-rate') throw new Error('Use ue-rate [--requests-per-second=RATE]');
  if (args.length === 1) return undefined;
  const match = args.length === 2 && /^--requests-per-second=(\d+(?:\.\d+)?)$/.exec(args[1]!);
  if (!match) throw new Error('Use ue-rate [--requests-per-second=RATE]');
  return validateUeRate(Number(match[1]));
}

/** Absolute Retry-After dates are compared with the database clock, never a worker clock. */
export function parseRetryAfter(value: string | null): { delayMs: number; at: Date | null } {
  if (!value?.trim()) return { delayMs: 0, at: null };
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    // An unreasonable numeric header still fails conservatively at a year.
    return { delayMs: Math.min(ms, 365 * 24 * 60 * 60_000), at: null };
  }
  const date = /^[A-Za-z]{3}, /.test(trimmed) ? new Date(trimmed) : null;
  return { delayMs: 0, at: date && Number.isFinite(date.getTime()) ? date : null };
}

/** One capacity-one token bucket per database, with no run/hex/worker namespace or local fallback. */
export class SharedUeRateLimiter implements UeRequestLimiter {
  constructor(private readonly db: Database, private readonly onThrottle?: (event: UeThrottleEvent) => Promise<void>) {}

  async state(): Promise<UeRateState> {
    const rows = await this.db.$queryRaw<UeRateState[]>`SELECT cap_rps AS "capRps", effective_rps AS "effectiveRps",
      next_request_at AS "nextRequestAt", blocked_until AS "blockedUntil", requests, waits, throttles
      FROM public.pipeline_ue_rate_limit WHERE singleton = true`;
    return this.required(rows);
  }

  /** Only the explicit operator command configures the shared cap; workers cannot reset backoff. */
  async configure(capRps: number): Promise<UeRateState> {
    validateUeRate(capRps);
    const rows = await this.db.$queryRaw<UeRateState[]>`UPDATE public.pipeline_ue_rate_limit SET cap_rps = ${capRps},
      effective_rps = LEAST(effective_rps, ${capRps}),
      next_request_at = GREATEST(next_request_at, clock_timestamp() + (1000 / LEAST(effective_rps, ${capRps})) * interval '1 millisecond'),
      updated_at = clock_timestamp()
      WHERE singleton = true
      RETURNING cap_rps AS "capRps", effective_rps AS "effectiveRps", next_request_at AS "nextRequestAt",
        blocked_until AS "blockedUntil", requests, waits, throttles`;
    return this.required(rows);
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    let countedWait = false;
    for (;;) {
      signal?.throwIfAborted();
      // Evaluate time after taking the lock. Never reserve a future permit: every wake
      // rechecks the latest cooldown, rate and cap before it can consume one token.
      const rows = await this.db.$queryRaw<{ allowed: boolean; waitMs: number }[]>`WITH locked AS MATERIALIZED (
          SELECT * FROM public.pipeline_ue_rate_limit WHERE singleton = true FOR UPDATE
        ), timing AS MATERIALIZED (SELECT *, clock_timestamp() AS now FROM locked),
        paced AS (SELECT *, CASE WHEN now >= recover_after AND now >= blocked_until
            THEN LEAST(cap_rps, effective_rps + cap_rps * 0.05) ELSE effective_rps END AS rate,
          now >= GREATEST(next_request_at, blocked_until) AS allowed FROM timing)
        UPDATE public.pipeline_ue_rate_limit s SET effective_rps = p.rate,
          recover_after = CASE WHEN p.now >= p.recover_after AND p.now >= p.blocked_until
            THEN p.now + interval '1 minute' ELSE p.recover_after END,
          next_request_at = CASE WHEN p.allowed THEN p.now + CEIL(1000 / p.rate) * interval '1 millisecond' ELSE p.next_request_at END,
          requests = s.requests + CASE WHEN p.allowed THEN 1 ELSE 0 END,
          waits = s.waits + CASE WHEN NOT p.allowed AND NOT ${countedWait} THEN 1 ELSE 0 END,
          updated_at = p.now
        FROM paced p WHERE s.singleton = p.singleton
        RETURNING p.allowed, GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(p.next_request_at, p.blocked_until) - p.now)) * 1000)::float8 AS "waitMs"`;
      const result = this.required(rows);
      signal?.throwIfAborted();
      if (result.allowed) return;
      countedWait = true;
      // Bound sleeps to observe shared changes promptly; lease cancellation interrupts immediately.
      await delay(Math.max(1, Math.min(1000, Math.ceil(result.waitMs))), undefined, { ...(signal ? { signal } : {}) });
    }
  }

  async throttle(status: 403 | 429, retryAfter: string | null): Promise<void> {
    const retry = parseRetryAfter(retryAfter), minimumMs = status === 403 ? 300_000 : 30_000;
    const rows = await this.db.$queryRaw<UeRateState[]>`WITH locked AS MATERIALIZED (
        SELECT * FROM public.pipeline_ue_rate_limit WHERE singleton = true FOR UPDATE
      ), timing AS MATERIALIZED (SELECT *, clock_timestamp() AS now FROM locked)
      UPDATE public.pipeline_ue_rate_limit s SET effective_rps = GREATEST(0.01, t.effective_rps / 2),
        blocked_until = GREATEST(t.blocked_until, t.now + ${Math.max(minimumMs, retry.delayMs)} * interval '1 millisecond', ${retry.at}::timestamptz),
        recover_after = GREATEST(t.blocked_until, t.now + ${Math.max(minimumMs, retry.delayMs)} * interval '1 millisecond', ${retry.at}::timestamptz) + interval '1 minute',
        throttles = s.throttles + 1, last_throttle_status = ${status}, last_throttle_at = t.now, updated_at = t.now
      FROM timing t WHERE s.singleton = t.singleton
      RETURNING s.cap_rps AS "capRps", s.effective_rps AS "effectiveRps", s.next_request_at AS "nextRequestAt",
        s.blocked_until AS "blockedUntil", s.requests, s.waits, s.throttles`;
    const state = this.required(rows);
    const event: UeThrottleEvent = { event: 'ue_throttle', status, capRps: state.capRps, effectiveRps: state.effectiveRps,
      blockedUntil: state.blockedUntil.toISOString(), throttles: String(state.throttles) };
    console.warn(JSON.stringify(event));
    await this.onThrottle?.(event);
  }

  private required<T>(rows: T[]): T {
    if (!rows[0]) throw new Error('Shared UE limiter state missing; apply the guarded migration before running workers');
    return rows[0];
  }
}
