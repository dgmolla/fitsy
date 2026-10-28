import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma, type HexJob, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { journalHeader, reservationUsd, V2Ledger, type JournalEvent, type JournalIdentity } from './journal';
import { SharedServiceBudget } from './service-budget';

type Database = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
const columns = Prisma.sql`run_id AS "runId", hex_id AS "hexId", status, attempts, max_attempts AS "maxAttempts",
  next_retry_at AS "nextRetryAt", checkpoint, lease_owner AS "leaseOwner", lease_token::text AS "leaseToken",
  lease_expires_at AS "leaseExpiresAt", priority, cap_usd AS "capUsd", last_error AS "lastError",
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const eventSchema = z.object({ event: z.string() }).catchall(z.unknown());
const checkpointSchema = z.object({ version: z.literal(1), sequence: z.number().int().nonnegative(), identity: eventSchema });
export const DEFAULT_LEASE_MS = 60_000;
export class LeaseLostError extends Error {
  constructor() { super('Hex job lease lost; stop this attempt'); this.name = 'LeaseLostError'; }
}
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** (attempt - 1), 30 * 60_000);
}

/** DB time, row locks and per-claim tokens are authoritative, never worker clocks or labels. */
export class HexJobQueue {
  constructor(readonly db: Database, readonly leaseMs = DEFAULT_LEASE_MS) {
    if (!Number.isInteger(leaseMs) || leaseMs < 15_000 || leaseMs > 300_000) throw new Error('Lease must be 15000-300000ms');
  }

  async enqueue(identity: JournalIdentity, capUsd = 5, maxAttempts = 3, priority = 0): Promise<HexJob> {
    if (!Number.isFinite(capUsd) || capUsd < 0 || capUsd > 5 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100
      || !Number.isInteger(priority) || priority < -2147483648 || priority > 2147483647) throw new Error('Invalid hex job configuration');
    const checkpoint = JSON.stringify({ version: 1, sequence: 0, identity: journalHeader(identity, capUsd) });
    const rows = await this.db.$queryRaw<HexJob[]>`INSERT INTO public.hex_jobs (run_id, hex_id, checkpoint, cap_usd, max_attempts, priority)
      VALUES (${identity.runId}, ${identity.hexId}, ${checkpoint}::jsonb, ${capUsd}, ${maxAttempts}, ${priority})
      ON CONFLICT (run_id, hex_id) DO UPDATE SET priority = GREATEST(hex_jobs.priority, EXCLUDED.priority)
      WHERE hex_jobs.cap_usd = EXCLUDED.cap_usd AND hex_jobs.max_attempts = EXCLUDED.max_attempts
        AND hex_jobs.checkpoint->'identity' = EXCLUDED.checkpoint->'identity'
      RETURNING ${columns}`;
    if (!rows[0]) throw new Error('Existing hex job identity, protocol, cap or attempt limit changed');
    return rows[0];
  }

  async claim(runId: string, owner: string): Promise<HexJob | null> {
    if (!owner.trim() || owner.length > 128) throw new Error('Worker ID must be 1-128 characters');
    const rows = await this.db.$queryRaw<HexJob[]>`WITH exhausted AS (
        SELECT run_id, hex_id FROM public.hex_jobs WHERE run_id = ${runId} AND status = 'running'
          AND lease_expires_at <= clock_timestamp() AND attempts >= max_attempts FOR UPDATE SKIP LOCKED
      ), parked AS (
        UPDATE public.hex_jobs j SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
          last_error = 'lease expired after final attempt', updated_at = clock_timestamp()
        FROM exhausted e WHERE j.run_id = e.run_id AND j.hex_id = e.hex_id RETURNING j.hex_id
      ), candidate AS (
        SELECT run_id, hex_id FROM public.hex_jobs WHERE run_id = ${runId} AND attempts < max_attempts
          AND public.pipeline_budget_available('jev', ${reservationUsd}::numeric)
          AND ((status = 'pending' AND next_retry_at <= clock_timestamp())
            OR (status = 'running' AND lease_expires_at <= clock_timestamp()))
        ORDER BY priority DESC, next_retry_at, hex_id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE public.hex_jobs j SET status = 'running', attempts = attempts + 1, lease_owner = ${owner},
        lease_token = ${randomUUID()}::uuid, lease_expires_at = clock_timestamp() + ${this.leaseMs} * interval '1 millisecond',
        updated_at = clock_timestamp()
      FROM candidate c WHERE j.run_id = c.run_id AND j.hex_id = c.hex_id
      RETURNING ${Prisma.sql`j.run_id AS "runId", j.hex_id AS "hexId", j.status, j.attempts, j.max_attempts AS "maxAttempts",
        j.next_retry_at AS "nextRetryAt", j.checkpoint, j.lease_owner AS "leaseOwner", j.lease_token::text AS "leaseToken",
        j.lease_expires_at AS "leaseExpiresAt", j.priority, j.cap_usd AS "capUsd", j.last_error AS "lastError",
        j.created_at AS "createdAt", j.updated_at AS "updatedAt"`}`;
    return rows[0] ?? null;
  }

  async renew(job: HexJob): Promise<void> {
    this.owned(await this.db.$executeRaw`UPDATE public.hex_jobs
      SET lease_expires_at = clock_timestamp() + ${this.leaseMs} * interval '1 millisecond', updated_at = clock_timestamp()
      WHERE run_id = ${job.runId} AND hex_id = ${job.hexId} AND status = 'running'
        AND lease_token = ${job.leaseToken}::uuid AND lease_owner = ${job.leaseOwner} AND lease_expires_at > clock_timestamp()`);
  }

  async append(job: HexJob, event: JournalEvent): Promise<void> {
    // Only the same completed attempt may finish its timing/report records. It cannot reserve more work.
    const finalEvent = event.event === 'completed' || event.event === 'attempt_end';
    this.owned(await this.db.$executeRaw`WITH active AS (UPDATE public.hex_jobs
      SET checkpoint = jsonb_set(checkpoint, '{sequence}', to_jsonb((checkpoint->>'sequence')::int + 1)), updated_at = clock_timestamp(),
        lease_expires_at = CASE WHEN status = 'running' THEN clock_timestamp() + ${this.leaseMs} * interval '1 millisecond' ELSE NULL END
      WHERE run_id = ${job.runId} AND hex_id = ${job.hexId} AND lease_token = ${job.leaseToken}::uuid
        AND ((status = 'running' AND lease_owner = ${job.leaseOwner} AND lease_expires_at > clock_timestamp())
          OR (status = 'completed' AND ${finalEvent}))
      RETURNING run_id, hex_id, (checkpoint->>'sequence')::int AS sequence)
      INSERT INTO public.hex_job_events (run_id, hex_id, sequence, event)
      SELECT run_id, hex_id, sequence, ${JSON.stringify(event)}::jsonb FROM active`);
  }

  async events(job: HexJob): Promise<JournalEvent[]> {
    const checkpoint = checkpointSchema.parse(job.checkpoint);
    const rows = await this.db.$queryRaw<{ sequence: number; event: Prisma.JsonValue }[]>`SELECT sequence, event FROM public.hex_job_events
      WHERE run_id = ${job.runId} AND hex_id = ${job.hexId} ORDER BY sequence`;
    if (rows.length !== checkpoint.sequence || rows.some((row, index) => row.sequence !== index + 1)) throw new Error('Incomplete shared journal; inspect checkpoint');
    return [checkpoint.identity, ...rows.map(row => eventSchema.parse(row.event))];
  }

  async fail(job: HexJob, terminal = false): Promise<void> {
    this.owned(await this.db.$executeRaw`UPDATE public.hex_jobs
      SET status = CASE WHEN ${terminal} OR attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        next_retry_at = clock_timestamp() + ${retryDelayMs(job.attempts)} * interval '1 millisecond',
        lease_owner = NULL, lease_expires_at = NULL,
        last_error = ${terminal ? 'accounting or protocol stop; inspect checkpoint before reconciliation' : 'hex attempt failed'}, updated_at = clock_timestamp()
      WHERE run_id = ${job.runId} AND hex_id = ${job.hexId} AND status = 'running'
        AND lease_token = ${job.leaseToken}::uuid AND lease_owner = ${job.leaseOwner} AND lease_expires_at > clock_timestamp()`);
  }

  async deferBudget(job: HexJob): Promise<void> {
    this.owned(await this.db.$executeRaw`UPDATE public.hex_jobs SET status='pending', attempts=GREATEST(attempts-1,0),
      next_retry_at=((clock_timestamp() AT TIME ZONE 'UTC')::date + 1)::timestamp AT TIME ZONE 'UTC',
      lease_owner=NULL, lease_expires_at=NULL, last_error='daily service budget exhausted', updated_at=clock_timestamp()
      WHERE run_id=${job.runId} AND hex_id=${job.hexId} AND status='running' AND lease_token=${job.leaseToken}::uuid
        AND lease_owner=${job.leaseOwner} AND lease_expires_at>clock_timestamp()`);
  }

  async lockInTx(job: HexJob, tx: Prisma.TransactionClient): Promise<void> {
    const rows = await tx.$queryRaw<{ hex_id: string }[]>`SELECT hex_id FROM public.hex_jobs
      WHERE run_id = ${job.runId} AND hex_id = ${job.hexId} AND status = 'running'
        AND lease_token = ${job.leaseToken}::uuid AND lease_owner = ${job.leaseOwner} AND lease_expires_at > clock_timestamp()
      FOR UPDATE`;
    this.owned(rows.length);
  }

  /** Call only after lockInTx, inside the existing atomic hex transaction. */
  async completeInTx(job: HexJob, tx: Prisma.TransactionClient): Promise<void> {
    this.owned(await tx.$executeRaw`UPDATE public.hex_jobs SET status = 'completed', lease_owner = NULL,
      lease_expires_at = NULL, last_error = NULL, updated_at = clock_timestamp()
      WHERE run_id = ${job.runId} AND hex_id = ${job.hexId} AND status = 'running' AND lease_token = ${job.leaseToken}::uuid`);
  }

  private owned(count: number): void { if (count !== 1) throw new LeaseLostError(); }
}

/** A failed renewal aborts transports and prevents the worker from beginning its next operation. */
export class HexJobLease {
  readonly controller = new AbortController();
  private readonly stopped = new AbortController();
  private readonly heartbeat: Promise<void>;
  constructor(readonly queue: HexJobQueue, readonly job: HexJob) {
    this.heartbeat = this.renewUntilStopped();
  }
  private async renewUntilStopped(): Promise<void> {
    while (!this.stopped.signal.aborted) {
      try { await delay(Math.floor(this.queue.leaseMs / 3), undefined, { signal: this.stopped.signal, ref: false }); }
      catch { return; }
      if (this.stopped.signal.aborted) return;
      try { await this.queue.renew(this.job); }
      catch { this.controller.abort(new LeaseLostError()); return; }
    }
  }
  async stop(): Promise<void> { this.stopped.abort(); await this.heartbeat; }
}

export class SharedV2Journal extends V2Ledger {
  private constructor(readonly queue: HexJobQueue, readonly job: HexJob, target: string, private readonly activeSignal: AbortSignal, events: JournalEvent[]) {
    super(job.capUsd, new SharedServiceBudget(queue.db));
    this.load(events, { runId: job.runId, hexId: job.hexId, target }, job.capUsd);
  }
  static async open(queue: HexJobQueue, job: HexJob, target: string, signal: AbortSignal): Promise<SharedV2Journal> {
    return new SharedV2Journal(queue, job, target, signal, await queue.events(job));
  }
  override get signal(): AbortSignal { return this.activeSignal; }
  async append(event: JournalEvent): Promise<void> {
    this.signal.throwIfAborted();
    await this.queue.append(this.job, event);
    this.events.push(event);
  }
  close(): void { /* The worker owns the heartbeat, not a local file lock. */ }
}
