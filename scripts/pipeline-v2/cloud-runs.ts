import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CLOUD_RUN_PREFIX } from './cloud-budget';
import { protocolHash, reservationUsd } from './journal';
import { HexJobQueue } from './queue';
import { validateV2Hex } from './run';

const startSchema = z.object({
  runId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  hexIds: z.array(z.string()).min(1).max(1000),
  maxHexes: z.number().int().min(1).max(1000),
  budgetUsd: z.number().finite().min(0).max(5000),
}).strict();
export type RunStart = z.infer<typeof startSchema>;
export class RunRequestError extends Error {}
export class RunConflictError extends Error {}
export function parseRunStart(input: unknown): RunStart {
  try {
    const result = startSchema.parse(input);
    result.hexIds.forEach(validateV2Hex);
    if (new Prisma.Decimal(result.budgetUsd).decimalPlaces() > 9) throw new Error();
    // Count distinct hexes, with an explicit finite upper bound even for a larger supplied list.
    return { ...result, hexIds: [...new Set(result.hexIds)].slice(0, result.maxHexes) };
  } catch { throw new RunRequestError('Start requires runId, explicit LA hexIds, maxHexes (1-1000), and budgetUsd (0-5000, up to 9 decimals)'); }
}
export interface RunState {
  runId: string; status: 'running' | 'completed' | 'budget_cap' | 'failed';
  maxHexes: number; budgetUsd: number; costUsd: number; reservedUsd: number;
  selectedHexes: number; completedHexes: number; failedHexes: number; activeHexes: number;
}
const stateColumns = Prisma.sql`r.run_id AS "runId", r.status, r.max_hexes AS "maxHexes", r.budget_usd::float8 AS "budgetUsd",
  (r.charged_usd-r.reserved_usd)::float8 AS "costUsd", r.reserved_usd::float8 AS "reservedUsd",
  COUNT(j.hex_id)::int AS "selectedHexes", COUNT(*) FILTER (WHERE j.status='completed')::int AS "completedHexes",
  COUNT(*) FILTER (WHERE j.status='failed')::int AS "failedHexes", COUNT(*) FILTER (WHERE j.status='running')::int AS "activeHexes"`;

/** One active refresh, atomic selection, and immutable idempotent starts across replicas. */
export class CloudRuns {
  constructor(readonly db: PrismaClient, readonly target: string) {}
  async start(input: unknown): Promise<RunState> {
    const request = parseRunStart(input), runId = CLOUD_RUN_PREFIX + request.runId;
    const config = JSON.stringify({ ...request, target: this.target, protocolHash });
    await this.db.$transaction(async tx => {
      // All starts serialize, including starts racing with an already stopped run's draining lease.
      await tx.$executeRaw`LOCK TABLE public.pipeline_runs IN SHARE ROW EXCLUSIVE MODE`;
      const existing = await tx.$queryRaw<{ matches: boolean }[]>`SELECT config=${config}::jsonb AS matches FROM public.pipeline_runs WHERE run_id=${runId}`;
      if (existing[0]) {
        if (!existing[0].matches) throw new RunConflictError('Run identity or limits changed; retained spend cannot be reset');
        return;
      }
      const [busy] = await tx.$queryRaw<{ busy: boolean }[]>`SELECT EXISTS(SELECT 1 FROM public.pipeline_runs WHERE status='running')
        OR EXISTS(SELECT 1 FROM public.hex_jobs WHERE status='running' AND lease_expires_at>clock_timestamp()) AS busy`;
      if (busy?.busy) throw new RunConflictError('Another refresh or draining worker is active');
      const status = request.budgetUsd < reservationUsd ? 'budget_cap' : 'running';
      await tx.$executeRaw`INSERT INTO public.pipeline_runs(run_id,config,max_hexes,budget_usd,status)
        VALUES (${runId},${config}::jsonb,${request.maxHexes},${request.budgetUsd}::numeric,${status})`;
      const queue = new HexJobQueue(tx);
      for (const hexId of request.hexIds) await queue.enqueue({ runId, hexId, target: this.target });
    });
    return (await this.state(runId))!;
  }
  async state(runId: string): Promise<RunState | null> {
    const [row] = await this.db.$queryRaw<RunState[]>`SELECT ${stateColumns} FROM public.pipeline_runs r
      LEFT JOIN public.hex_jobs j ON j.run_id=r.run_id WHERE r.run_id=${runId} GROUP BY r.run_id`;
    return row ?? null;
  }
  async active(): Promise<string | null> {
    const [row] = await this.db.$queryRaw<{ run_id: string }[]>`SELECT run_id FROM public.pipeline_runs WHERE status='running'`;
    return row?.run_id ?? null;
  }
  async refresh(runId: string): Promise<RunState | null> {
    await this.db.$executeRaw`UPDATE public.pipeline_runs r SET status=CASE
        WHEN NOT EXISTS(SELECT 1 FROM public.hex_jobs j WHERE j.run_id=r.run_id AND j.status<>'completed') THEN 'completed'
        WHEN NOT EXISTS(SELECT 1 FROM public.hex_jobs j WHERE j.run_id=r.run_id AND j.status IN ('pending','running')) THEN 'failed'
        WHEN r.charged_usd+${reservationUsd}::numeric>r.budget_usd AND (r.reserved_usd=0 OR
          NOT EXISTS(SELECT 1 FROM public.hex_jobs j WHERE j.run_id=r.run_id AND j.status='running' AND j.lease_expires_at>clock_timestamp())) THEN 'budget_cap'
        ELSE r.status END, updated_at=clock_timestamp()
      WHERE r.run_id=${runId} AND r.status='running'`;
    return this.state(runId);
  }
}
