import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { DailyBudgetExceeded, SharedServiceBudget, type PaidService } from './service-budget';

export const CLOUD_RUN_PREFIX = 'pipeline-v2-dev:cloud:';
export class RunBudgetExceeded extends Error {
  constructor() { super('Run budget unavailable; retain the job and its journal'); this.name = 'RunBudgetExceeded'; }
}

/** Reserve both caps in one database transaction; no per-replica counters or local fallback. */
export class CloudRunBudget extends SharedServiceBudget {
  constructor(db: Pick<PrismaClient, '$queryRaw'>, readonly runId: string) { super(db); }
  override async reserve(service: PaidService, usd: number, scope: string): Promise<string> {
    if (!Number.isFinite(usd) || usd < 0 || !scope) throw new Error('Invalid paid request reservation');
    const [row] = await this.db.$queryRaw<{ id: string | null; reason: string | null }[]>`SELECT * FROM public.pipeline_run_reserve(
      ${this.runId}::text, ${randomUUID()}::uuid, ${service}::text, ${usd}::numeric, ${scope}::text)`;
    if (!row) throw new Error('Missing shared run budget state; paid work refused');
    if (row.id) return row.id;
    if (row.reason === 'daily') throw new DailyBudgetExceeded(service);
    if (row.reason === 'run') throw new RunBudgetExceeded();
    throw new Error('Invalid run budget admission');
  }
  override async settle(id: string, usd: number | null, throttled = false): Promise<void> {
    if (usd !== null && (!Number.isFinite(usd) || usd < 0)) throw new Error('Invalid paid request charge');
    const rows = await this.db.$queryRaw<{ id: string }[]>`SELECT public.pipeline_run_settle(
      ${this.runId}::text, ${id}::uuid, ${usd}::numeric, ${throttled}::boolean)::text AS id`;
    if (rows.length !== 1) throw new Error('Missing or already settled run request');
  }
}
