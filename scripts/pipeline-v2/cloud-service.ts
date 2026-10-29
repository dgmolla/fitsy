import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PrismaClient } from '@prisma/client';
import { CLOUD_RUN_PREFIX } from './cloud-budget';
import { CloudRuns, RunConflictError, RunRequestError } from './cloud-runs';
import { HexJobQueue } from './queue';
import { workV2Job } from './queue-worker';
import type { JournalEvent } from './journal';
import { SharedServiceBudget } from './service-budget';
import { v2Telemetry } from './telemetry';

const respond = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value) + '\n');
};
async function jsonBody(req: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk as Uint8Array); bytes += buffer.length;
    if (bytes > 64 * 1024) { req.resume(); throw new RunRequestError('Run request exceeds 64 KiB'); }
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new RunRequestError('A JSON run request is required'); }
}

/** The deployment's Cloud Run IAM policy authenticates every external control request. */
export function cloudService(db: PrismaClient, target: string, source: JournalEvent, signal: AbortSignal) {
  const runs = new CloudRuns(db, target), queue = new HexJobQueue(db), workerId = randomUUID();
  let healthy = true;
  const server = createServer((req, res) => {
    void (async () => {
      if (signal.aborted) { respond(res, 503, { status: 'stopping' }); return; }
      if (req.method === 'GET' && req.url === '/healthz') { respond(res, healthy ? 200 : 503, { status: healthy ? 'ok' : 'degraded' }); return; }
      if (req.method === 'GET' && req.url === '/readyz') {
        await cloudReadiness(db);
        respond(res, 200, { status: 'ready' }); return;
      }
      if (req.method === 'POST' && req.url === '/runs') {
        // A local IAM proxy must not turn a cross-origin, no-CORS browser POST into paid work.
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new RunRequestError('Use Content-Type: application/json');
        respond(res, 200, await runs.start(await jsonBody(req))); return;
      }
      const match = /^\/runs\/([a-zA-Z0-9_-]{1,80})$/.exec(req.url ?? '');
      if (req.method === 'GET' && match) {
        const state = await runs.state(CLOUD_RUN_PREFIX + match[1]!);
        respond(res, state ? 200 : 404, state ?? { error: 'Run not found' }); return;
      }
      respond(res, 404, { error: 'Not found' });
    })().catch(error => {
      // Do not log request bodies, provider exceptions, connection strings or raw reports.
      const expected = error instanceof RunRequestError || error instanceof RunConflictError;
      respond(res, error instanceof RunRequestError ? 400 : error instanceof RunConflictError ? 409 : 503,
        { error: expected ? error.message : 'Worker database unavailable' });
    });
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  server.maxRequestsPerSocket = 100;
  async function work(): Promise<void> {
    while (!signal.aborted) {
      try {
        const runId = await runs.active();
        if (runId) {
          const outcome = await workV2Job(db, queue, runId, workerId, target, source, signal);
          await runs.refresh(runId);
          if (outcome) process.stdout.write(JSON.stringify({ event: 'cloud_hex', runId, workerId,
            hexId: outcome.hexId, attempt: outcome.attempt, status: outcome.status }) + '\n');
          if (outcome && process.env['AXIOM_TOKEN']) v2Telemetry.budgets(await new SharedServiceBudget(db).state());
        }
        healthy = true;
      } catch {
        if (signal.aborted) break;
        healthy = false;
        process.stderr.write('Cloud worker attempt failed; retained database state is authoritative\n');
      }
      try { await delay(1000, undefined, { signal }); }
      catch { break; }
    }
  }
  return { server, work };
}

/** Real schema/configuration check; startup never resets shared limits or performs paid probes. */
export async function cloudReadiness(db: PrismaClient): Promise<void> {
  const [row] = await db.$queryRaw<{ ready: boolean }[]>`SELECT
    to_regprocedure('public.pipeline_run_reserve(text,uuid,text,numeric,text)') IS NOT NULL
    AND to_regprocedure('public.pipeline_run_settle(text,uuid,numeric,boolean)') IS NOT NULL
    AND to_regclass('public.hex_jobs') IS NOT NULL AND to_regclass('public.hex_job_events') IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.pipeline_ue_rate_limit WHERE singleton)
    AND (SELECT COUNT(*) FROM public.pipeline_service_budgets)=3
    AND NOT EXISTS(SELECT 1 FROM public.pipeline_runs WHERE max_hexes<1) AS ready`;
  if (!row?.ready) throw new Error('Cloud worker migrations, rate limiter or service budgets are missing');
}
