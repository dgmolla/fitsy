import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { LeaseLostError } from './queue';

type Database = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
export interface PdfJob {
  brandId: string; status: string; attempts: number; maxAttempts: number;
  nextRetryAt: Date; leaseOwner: string | null; leaseToken: string | null;
}
const columns = Prisma.sql`j.brand_id AS "brandId", j.status, j.attempts, j.max_attempts AS "maxAttempts",
  j.next_retry_at AS "nextRetryAt", j.lease_owner AS "leaseOwner", j.lease_token::text AS "leaseToken"`;
export const PDF_LEASE_MS = 180_000;
export const pdfRetryMs = (attempt: number) => Math.min(3_600_000 * 2 ** (attempt - 1), 86_400_000);

/** One global row per verified brand, independent of run, hex, location and worker. */
export class PdfJobQueue {
  constructor(readonly db: Database) {}

  async enqueue(brandId: string): Promise<boolean> {
    // This SQL is the cheap chain filter, including for direct callers. No provider is involved.
    return (await this.db.$executeRaw`INSERT INTO public.pipeline_pdf_jobs (brand_id)
      SELECT id FROM "Brand" WHERE id = ${brandId} AND "detectionConf" IN ('high', 'llm-confirmed')
        AND "menuKind" = 'restaurant'
      ON CONFLICT (brand_id) DO NOTHING`) === 1;
  }

  async claim(owner: string): Promise<PdfJob | null> {
    if (!owner.trim() || owner.length > 128) throw new Error('PDF worker ID must be 1-128 characters');
    const rows = await this.db.$queryRaw<PdfJob[]>`WITH exhausted AS (
      SELECT brand_id FROM public.pipeline_pdf_jobs WHERE status = 'running'
        AND lease_expires_at <= clock_timestamp() AND attempts >= max_attempts FOR UPDATE SKIP LOCKED
    ), parked AS (
      UPDATE public.pipeline_pdf_jobs j SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
        updated_at = clock_timestamp() FROM exhausted e WHERE j.brand_id = e.brand_id RETURNING j.brand_id
    ), candidate AS (
      SELECT brand_id FROM public.pipeline_pdf_jobs WHERE attempts < max_attempts
        AND public.pipeline_budget_available('pdf_finder', 0)
        AND next_retry_at <= clock_timestamp() AND (status = 'pending'
          OR (status = 'running' AND lease_expires_at <= clock_timestamp()))
      ORDER BY next_retry_at, brand_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE public.pipeline_pdf_jobs j SET status = 'running', attempts = attempts + 1,
      lease_owner = ${owner}, lease_token = ${randomUUID()}::uuid,
      lease_expires_at = clock_timestamp() + ${PDF_LEASE_MS} * interval '1 millisecond',
      next_retry_at = clock_timestamp() + LEAST(3600000::bigint * (2::bigint ^ attempts), 86400000::bigint) * interval '1 millisecond',
      updated_at = clock_timestamp()
      FROM candidate c WHERE j.brand_id = c.brand_id RETURNING ${columns}`;
    return rows[0] ?? null;
  }

  async deferBudget(job: PdfJob): Promise<void> {
    this.owned(await this.db.$executeRaw`UPDATE public.pipeline_pdf_jobs SET status='pending', attempts=GREATEST(attempts-1,0),
      next_retry_at=((clock_timestamp() AT TIME ZONE 'UTC')::date + 1)::timestamp AT TIME ZONE 'UTC',
      lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
      WHERE brand_id=${job.brandId} AND status='running' AND lease_token=${job.leaseToken}::uuid
        AND lease_owner=${job.leaseOwner} AND lease_expires_at>clock_timestamp()`);
  }

  async renew(job: PdfJob): Promise<void> {
    this.owned(await this.db.$executeRaw`UPDATE public.pipeline_pdf_jobs
      SET lease_expires_at = clock_timestamp() + ${PDF_LEASE_MS} * interval '1 millisecond', updated_at = clock_timestamp()
      WHERE brand_id = ${job.brandId} AND status = 'running' AND lease_token = ${job.leaseToken}::uuid
        AND lease_owner = ${job.leaseOwner} AND lease_expires_at > clock_timestamp()`);
  }

  async append(job: PdfJob, event: string, payload: unknown): Promise<void> {
    this.owned(await this.db.$executeRaw`WITH active AS (UPDATE public.pipeline_pdf_jobs
      SET updated_at = clock_timestamp(), lease_expires_at = clock_timestamp() + ${PDF_LEASE_MS} * interval '1 millisecond'
      WHERE brand_id = ${job.brandId} AND status = 'running' AND lease_token = ${job.leaseToken}::uuid
        AND lease_owner = ${job.leaseOwner} AND lease_expires_at > clock_timestamp() RETURNING brand_id)
      INSERT INTO public.pipeline_pdf_events (brand_id, attempt, event, payload)
      SELECT brand_id, ${job.attempts}, ${event}, ${JSON.stringify(payload)}::jsonb FROM active`);
  }

  async latest(job: PdfJob, event: string): Promise<unknown | null> {
    const rows = await this.db.$queryRaw<{ payload: unknown }[]>`SELECT payload FROM public.pipeline_pdf_events
      WHERE brand_id = ${job.brandId} AND event = ${event} ORDER BY attempt DESC LIMIT 1`;
    return rows[0]?.payload ?? null;
  }

  async lockInTx(job: PdfJob, tx: Prisma.TransactionClient): Promise<void> {
    const rows = await tx.$queryRaw<{ brand_id: string }[]>`SELECT brand_id FROM public.pipeline_pdf_jobs
      WHERE brand_id = ${job.brandId} AND status = 'running' AND lease_token = ${job.leaseToken}::uuid
        AND lease_owner = ${job.leaseOwner} AND lease_expires_at > clock_timestamp() FOR UPDATE`;
    this.owned(rows.length);
  }

  async finish(job: PdfJob, completed: boolean): Promise<void> {
    // The retry window was reserved before search. Failure or process death cannot shorten it.
    this.owned(await this.db.$executeRaw`UPDATE public.pipeline_pdf_jobs
      SET status = CASE WHEN ${completed} THEN 'completed' WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
      WHERE brand_id = ${job.brandId} AND status = 'running' AND lease_token = ${job.leaseToken}::uuid
        AND lease_owner = ${job.leaseOwner} AND lease_expires_at > clock_timestamp()`);
  }

  private owned(count: number): void { if (count !== 1) throw new LeaseLostError(); }
}
