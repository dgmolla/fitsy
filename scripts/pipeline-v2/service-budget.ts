import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { v2Telemetry } from './telemetry';

import { paidServices, type PaidService, type BudgetState, type PaidBudget } from './budget-types';
export { paidServices, type PaidService, type BudgetState, type PaidBudget } from './budget-types';
type Database = Pick<PrismaClient, '$queryRaw'>;
export class DailyBudgetExceeded extends Error {
  constructor(readonly service: PaidService) { super(`Daily ${service} budget exhausted; defer paid work until the next UTC day`); this.name = 'DailyBudgetExceeded'; }
}

/** Durable envelopes survive lease expiry, process death, retries and UTC rollover. */
export class SharedServiceBudget implements PaidBudget {
  constructor(readonly db: Database) {}
  async reserve(service: PaidService, usd: number, scope: string): Promise<string> {
    if (!Number.isFinite(usd) || usd < 0 || !scope) throw new Error('Invalid paid request reservation');
    const id = randomUUID();
    const [row] = await this.db.$queryRaw<{ id: string | null }[]>`SELECT public.pipeline_budget_reserve(
      ${id}::uuid, ${service}::text, ${usd}::numeric, ${scope}::text)::text AS id`;
    if (!row) throw new Error('Missing shared budget state; paid work refused');
    if (!row.id) { v2Telemetry.throttle(service, { reason: 'daily_cap' }); throw new DailyBudgetExceeded(service); }
    if (process.env['AXIOM_TOKEN']) v2Telemetry.budgets(await this.state());
    return row.id;
  }
  async settle(id: string, usd: number | null, throttled = false): Promise<void> {
    if (usd !== null && (!Number.isFinite(usd) || usd < 0)) throw new Error('Invalid paid request charge');
    // Unknown charges retain their full reservation, even on another day. A stale worker
    // may settle only its own permit; settlement cannot create a new transport permit.
    const rows = await this.db.$queryRaw<{ id: string; day: string }[]>`SELECT public.pipeline_budget_settle(
      ${id}::uuid, ${usd}::numeric, ${throttled}::boolean)::text AS id,
      (SELECT day::text FROM public.pipeline_paid_requests WHERE id=${id}::uuid) AS day`;
    if (rows.length !== 1) throw new Error('Missing or already settled paid request');
    if (process.env['AXIOM_TOKEN']) v2Telemetry.budgets(await this.state(rows[0]!.day));
  }
  async configure(service: PaidService, dailyUsd: number, dailyCalls: number): Promise<void> {
    if (!Number.isFinite(dailyUsd) || dailyUsd < 0 || !Number.isSafeInteger(dailyCalls) || dailyCalls < 0) throw new Error('Invalid daily service cap');
    const rows = await this.db.$queryRaw<{ service: string }[]>`UPDATE public.pipeline_service_budgets
      SET daily_usd=${dailyUsd}, daily_calls=${dailyCalls}, updated_at=clock_timestamp()
      WHERE service=${service} RETURNING service`;
    if (rows.length !== 1) throw new Error('Missing shared service budget');
  }
  async state(day?: string): Promise<BudgetState[]> {
    return this.db.$queryRaw<BudgetState[]>`WITH timing AS MATERIALIZED (SELECT COALESCE(${day ?? null}::date, (statement_timestamp() AT TIME ZONE 'UTC')::date) AS day)
      SELECT b.service, t.day::text, b.daily_usd::float8 AS "capUsd", b.daily_calls::text AS "capCalls",
        COALESCE(SUM(r.charged_usd-r.reserved_usd) FILTER (WHERE r.day=t.day),0)::float8 AS "costUsd",
        COALESCE(SUM(r.reserved_usd),0)::float8 AS "reservedUsd",
        COALESCE(SUM(r.calls) FILTER (WHERE r.day=t.day),0)::text AS calls,
        COALESCE(SUM(r.throttles) FILTER (WHERE r.day=t.day),0)::text AS throttles,
        statement_timestamp()::text AS "observedAt"
      FROM public.pipeline_service_budgets b CROSS JOIN timing t LEFT JOIN public.pipeline_service_days r
        ON r.service=b.service AND r.day<=t.day AND (r.day=t.day OR r.reserved_usd>0)
      GROUP BY b.service,b.daily_usd,b.daily_calls,t.day ORDER BY b.service`;
  }
}

export function parseBudgetOptions(args: string[]): { service: PaidService; usd: number; calls: number } | undefined {
  if (args[0] !== 'budgets') throw new Error('Use budgets [--service=jev|google|pdf_finder --daily-usd=USD --daily-calls=N]');
  if (args.length === 1) return undefined;
  const values = new Map<string, string>();
  for (const arg of args.slice(1)) {
    const match = /^--(service|daily-usd|daily-calls)=(.+)$/.exec(arg);
    if (!match || values.has(match[1]!)) throw new Error('Invalid or repeated budget option');
    values.set(match[1]!,match[2]!);
  }
  const service = values.get('service') as PaidService, usd = Number(values.get('daily-usd')), calls = Number(values.get('daily-calls'));
  if (values.size !== 3 || !paidServices.includes(service) || !Number.isFinite(usd) || usd < 0 || !Number.isSafeInteger(calls) || calls < 0) throw new Error('Invalid daily service cap');
  return { service, usd, calls };
}
