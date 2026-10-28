import type { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEV_POC_RUN_PREFIX } from '../hex-resume';
import { digest, type JournalEvent } from './journal';
import { HexJobLease, HexJobQueue, LeaseLostError, SharedV2Journal } from './queue';
import { runV2Hex, validateV2Cap, validateV2Hex, validateV2RunId } from './run';

export interface QueueOptions {
  mode: 'enqueue' | 'worker'; runId: string; hexIds: string[]; out: string; workerId: string;
  capUsd: number; maxAttempts: number; priority: number; maxJobs: number;
}
export function parseQueueOptions(args: string[]): QueueOptions {
  const mode = args[0];
  if (mode !== 'enqueue' && mode !== 'worker') throw new Error('Use enqueue or worker');
  const values = new Map<string, string>(), hexIds: string[] = [];
  const allowed = mode === 'enqueue' ? ['run-id', 'hex-id', 'cost-cap-usd', 'max-attempts', 'priority']
    : ['run-id', 'out', 'worker-id', 'max-jobs'];
  for (const arg of args.slice(1)) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !allowed.includes(match[1]!) || (match[1] !== 'hex-id' && values.has(match[1]!))) throw new Error('Invalid or repeated queue option');
    if (match[1] === 'hex-id') { validateV2Hex(match[2]!); hexIds.push(match[2]!); }
    else values.set(match[1]!, match[2]!);
  }
  const runId = values.get('run-id') ?? ''; validateV2RunId(runId);
  const capUsd = Number(values.get('cost-cap-usd') ?? 5); validateV2Cap(capUsd);
  const maxAttempts = Number(values.get('max-attempts') ?? 3), priority = Number(values.get('priority') ?? 0);
  const maxJobs = Number(values.get('max-jobs') ?? 1), out = values.get('out') ?? '', workerId = values.get('worker-id') ?? '';
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100 || !Number.isInteger(priority)
    || priority < -2147483648 || priority > 2147483647 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 1000) throw new Error('Invalid queue bounds');
  if (mode === 'enqueue' && !hexIds.length) throw new Error('Enqueue requires explicit --hex-id=HEX values');
  if (mode === 'worker' && (!out || !workerId.trim() || workerId.length > 128)) throw new Error('Worker requires --out=PRIVATE_DIR and --worker-id=ID');
  return { mode, runId: `${DEV_POC_RUN_PREFIX}queue:${runId}`, hexIds: [...new Set(hexIds)], out, workerId, capUsd, maxAttempts, priority, maxJobs };
}

/** One claim is a bounded unit; the future cloud service can repeatedly invoke this same worker. */
export async function workV2Job(prisma: PrismaClient, queue: HexJobQueue, runId: string, workerId: string, target: string, source: JournalEvent) {
  const job = await queue.claim(runId, workerId);
  if (!job) return null;
  const lease = new HexJobLease(queue, job);
  let journal: SharedV2Journal | undefined;
  try {
    journal = await SharedV2Journal.open(queue, job, target, lease.controller.signal);
    await journal.append(source);
    const report = await runV2Hex(prisma, { runId: job.runId, hexId: job.hexId, capUsd: job.capUsd, out: '' }, journal, {
      beforePersist: async () => { await lease.stop(); lease.controller.signal.throwIfAborted(); await queue.renew(job); },
      guardInTx: tx => queue.lockInTx(job, tx),
      checkpointInTx: tx => queue.completeInTx(job, tx),
    });
    await lease.stop(); lease.controller.signal.throwIfAborted();
    if (report.status === 'completed') {
      // Recovery of an existing atomic checkpoint also needs an ownership-fenced acknowledgement.
      if ('resumedCheckpoint' in report) await prisma.$transaction(async tx => {
        await queue.lockInTx(job, tx);
        if (!await tx.pipelineCompletedHex.findUnique({ where: { runId_hexId: { runId: job.runId, hexId: job.hexId } } })) throw new Error('Missing hex checkpoint');
        await queue.completeInTx(job, tx);
      });
      return { hexId: job.hexId, attempt: job.attempts, status: 'completed', report };
    }
    const terminal = journal.unknown || Boolean(journal.stopped);
    await queue.fail(job, terminal);
    return { hexId: job.hexId, attempt: job.attempts, status: terminal || job.attempts >= job.maxAttempts ? 'failed' : 'retry', report };
  } catch (error) {
    await lease.stop();
    if (error instanceof LeaseLostError || lease.controller.signal.aborted) return { hexId: job.hexId, attempt: job.attempts, status: 'lease_lost' };
    // Invalid identity/protocol/checkpoint cannot be made safe by another automatic paid attempt.
    await queue.fail(job, !journal || journal.unknown || Boolean(journal.stopped));
    throw error;
  } finally { await lease.stop(); journal?.close(); }
}

export async function runQueueCommand(prisma: PrismaClient, options: QueueOptions, target: string, source: JournalEvent) {
  const queue = new HexJobQueue(prisma);
  if (options.mode === 'enqueue') {
    for (const hexId of options.hexIds) await queue.enqueue({ runId: options.runId, hexId, target }, options.capUsd, options.maxAttempts, options.priority);
    return { runId: options.runId, enqueued: options.hexIds.length };
  }
  const outcomes = [];
  for (let i = 0; i < options.maxJobs; i++) {
    const outcome = await workV2Job(prisma, queue, options.runId, options.workerId, target, source);
    if (!outcome) break;
    outcomes.push(outcome);
    // This is a private export, never the recovery source. The DB checkpoint is authoritative.
    const directory = join(options.out, digest([options.runId, outcome.hexId]));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, `attempt-${outcome.attempt}.json`), JSON.stringify(outcome, null, 2) + '\n', { mode: 0o600 });
    if (outcome.status !== 'completed') break;
  }
  return { runId: options.runId, status: outcomes.length ? outcomes.at(-1)!.status : 'idle', outcomes };
}
