import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient, type HexJob } from '@prisma/client';
import { assertTestDatabase } from '../../../../scripts/lib/test-database-guard';
import { HexJobLease, HexJobQueue, LeaseLostError, SharedV2Journal } from '../../../../scripts/pipeline-v2/queue';
import { targetIdentity } from '../../../../scripts/pipeline-v2/run';
import { persistHex } from '../../../../scripts/hex-persist';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const hex = '8729a1d75ffffff', root = resolve(__dirname, '../../../..');
suite('shared hex queue (real Postgres and real CLI, only provider HTTP substituted)', () => {
  const db = new PrismaClient(), other = new PrismaClient(), queue = new HexJobQueue(db);
  const runIds: string[] = [], directories: string[] = [], restaurantIds: string[] = [];
  const children = new Map<ChildProcess, Promise<{ code: number | null; signal: string | null; stderr: string }>>();
  const identity = (hexId = hex) => {
    const runId = `pipeline-v2-dev:queue:test-${randomUUID()}`; runIds.push(runId);
    return { runId, hexId, target: targetIdentity(assertTestDatabase(process.env['POSTGRES_PRISMA_URL'])) };
  };
  const expire = (job: HexJob) => db.$executeRaw`UPDATE public.hex_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'
    WHERE run_id = ${job.runId} AND hex_id = ${job.hexId}`;
  async function due(job: HexJob) {
    await db.$executeRaw`UPDATE public.hex_jobs SET next_retry_at = clock_timestamp() - interval '1 second'
      WHERE run_id = ${job.runId} AND hex_id = ${job.hexId}`;
  }
  afterEach(async () => {
    for (const [child, done] of children) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done; }
    children.clear();
    await db.hexJob.deleteMany({ where: { runId: { in: runIds } } });
    await db.pipelineCompletedHex.deleteMany({ where: { runId: { in: runIds.splice(0) } } });
    await db.restaurant.deleteMany({ where: { id: { in: restaurantIds.splice(0) } } });
    directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }));
  });
  afterAll(async () => { await db.$disconnect(); await other.$disconnect(); });

  test('queue and paid-call events retain pipeline-only writes, audit reads and no application/client access', async () => {
    const id = identity();
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE pipeline_writer');
      const writer = new HexJobQueue(tx);
      await writer.enqueue(id);
      const job = (await writer.claim(id.runId, 'role-fixture'))!;
      await writer.append(job, { event: 'role-check' });
    });
    for (const table of ['hex_jobs', 'hex_job_events']) {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE fitsy_app');
        await tx.$queryRawUnsafe(`SELECT count(*) FROM public.${table}`);
      })).rejects.toMatchObject({ meta: { code: '42501' } });
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE fitsy_audit_readonly');
        const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM public.${table}`);
        expect(rows[0]!.count).toBeGreaterThan(0n);
      });
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE fitsy_audit_readonly');
        await tx.$executeRawUnsafe(`DELETE FROM public.${table} WHERE false`);
      })).rejects.toMatchObject({ meta: { code: '42501' } });
    }
    for (const operation of ['UPDATE public.hex_job_events SET event=event WHERE false', 'DELETE FROM public.hex_job_events WHERE false']) {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE pipeline_writer'); await tx.$executeRawUnsafe(operation);
      })).rejects.toMatchObject({ meta: { code: '42501' } });
    }
  });

  test('simultaneous workers claim a single hex exactly once and an active lease is never reclaimed', async () => {
    const job = await queue.enqueue(identity());
    const competitors = [queue, new HexJobQueue(other)];
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => competitors[i % 2]!.claim(job.runId, `worker-${i}`)));
    const claims = results.filter((r): r is HexJob => r !== null);
    expect(claims).toHaveLength(1); expect(claims[0]!.attempts).toBe(1);
    expect(await queue.claim(job.runId, 'worker-late')).toBeNull();
    await queue.renew(claims[0]!);
    expect(await queue.claim(job.runId, 'worker-late')).toBeNull();
  });

  test('locked high-priority work is skipped while another hex proceeds', async () => {
    const id = identity();
    await queue.enqueue(id, 5, 3, 10); await queue.enqueue({ ...id, hexId: '8729a1d74ffffff' }, 5, 3, 0);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT hex_id FROM public.hex_jobs WHERE run_id = ${id.runId} AND hex_id = ${id.hexId} FOR UPDATE`;
      const claimed = await new HexJobQueue(other).claim(id.runId, 'other');
      expect(claimed?.hexId).toBe('8729a1d74ffffff');
    });
    expect((await queue.claim(id.runId, 'priority'))?.hexId).toBe(id.hexId);
  });

  test('expired claims preserve checkpoints and reject stale renewals, writes and acknowledgements even with a reused owner', async () => {
    const id = identity(); await queue.enqueue(id);
    const old = (await queue.claim(id.runId, 'worker'))!;
    await queue.append(old, { event: 'test-checkpoint', value: 'durable' }); await expire(old);
    await expect(queue.renew(old)).rejects.toBeInstanceOf(LeaseLostError);
    const recovered = (await queue.claim(id.runId, 'worker'))!;
    expect(recovered.attempts).toBe(2); expect(recovered.leaseToken).not.toBe(old.leaseToken);
    expect(await queue.events(recovered)).toContainEqual({ event: 'test-checkpoint', value: 'durable' });
    await expect(queue.append(old, { event: 'jev_request' })).rejects.toBeInstanceOf(LeaseLostError);
    await expect(queue.fail(old)).rejects.toBeInstanceOf(LeaseLostError);
    await expect(db.$transaction(tx => queue.lockInTx(old, tx))).rejects.toBeInstanceOf(LeaseLostError);
    await expect(queue.renew(recovered)).resolves.toBeUndefined();
  });

  test('transient failures back off, retain progress and park at the fixed attempt limit', async () => {
    const id = identity(); await queue.enqueue(id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const job = (await queue.claim(id.runId, 'worker'))!;
      expect(job.attempts).toBe(attempt);
      await queue.fail(job);
      const [state] = await db.$queryRaw<{ status: string; delay: number }[]>`SELECT status,
        EXTRACT(EPOCH FROM (next_retry_at - clock_timestamp()))::float8 AS delay FROM public.hex_jobs
        WHERE run_id = ${id.runId} AND hex_id = ${id.hexId}`;
      expect(state!.status).toBe(attempt === 3 ? 'failed' : 'pending');
      expect(state!.delay).toBeGreaterThan(30 * 2 ** (attempt - 1) - 5);
      expect(state!.delay).toBeLessThanOrEqual(30 * 2 ** (attempt - 1));
      expect(await queue.claim(id.runId, 'too-early')).toBeNull(); await due(job);
    }
    expect(await queue.claim(id.runId, 'finished')).toBeNull();
    await expect(queue.enqueue(id, 4)).rejects.toThrow('changed');
    await expect(queue.enqueue(id, 5, 5)).rejects.toThrow('changed');
    expect((await queue.enqueue(id)).status).toBe('failed');
  });

  test('expiration of the last allowed claim parks the job without an extra attempt', async () => {
    const id = identity(); await queue.enqueue(id, 5, 1);
    const job = (await queue.claim(id.runId, 'killed'))!; await expire(job);
    expect(await queue.claim(id.runId, 'replacement')).toBeNull();
    expect(await db.hexJob.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } })).toMatchObject({ status: 'failed', attempts: 1, leaseOwner: null, leaseExpiresAt: null });
  });

  test('menu persistence, legacy hex checkpoint and job completion roll back together', async () => {
    const id = identity(); await queue.enqueue(id);
    const job = (await queue.claim(id.runId, 'writer'))!;
    await expect(persistHex(id.runId, id.hexId, [], db, {
      guardInTx: tx => queue.lockInTx(job, tx),
      checkpointInTx: async tx => { await queue.completeInTx(job, tx); throw new Error('abort the transaction'); },
    })).rejects.toThrow('abort the transaction');
    expect(await db.pipelineCompletedHex.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } })).toBeNull();
    expect((await db.hexJob.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } }))?.status).toBe('running');
    await persistHex(id.runId, id.hexId, [], db, { guardInTx: tx => queue.lockInTx(job, tx), checkpointInTx: tx => queue.completeInTx(job, tx) });
    expect((await db.hexJob.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } }))?.status).toBe('completed');
    expect(await queue.claim(id.runId, 'another')).toBeNull();
    await expect(queue.append(job, { event: 'jev_request' })).rejects.toBeInstanceOf(LeaseLostError);
  });

  test('heartbeat renews a quiet worker and failed renewal aborts its provider signal', async () => {
    const id = identity(), shortQueue = new HexJobQueue(db, 15_000); await shortQueue.enqueue(id);
    const job = (await shortQueue.claim(id.runId, 'quiet'))!, lease = new HexJobLease(shortQueue, job);
    try {
      await new Promise(resolve => setTimeout(resolve, 5_100));
      const renewed = (await db.hexJob.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } }))!;
      expect(renewed.leaseExpiresAt!.getTime()).toBeGreaterThan(job.leaseExpiresAt!.getTime());
      await expire(job);
      await new Promise(resolve => setTimeout(resolve, 5_100));
      expect(lease.controller.signal.aborted).toBe(true);
      const journal = await SharedV2Journal.open(shortQueue, job, id.target, lease.controller.signal);
      await expect(journal.append({ event: 'jev_request' })).rejects.toBeInstanceOf(LeaseLostError);
    } finally { await lease.stop(); }
  }, 20_000);

  function startWorker(runId: string, directory: string, extra: Record<string, string> = {}) {
    const out = join(directory, randomUUID());
    const child = spawn(process.execPath, ['--require', join(root, 'scripts/test-fixtures/pipeline-v2-runtime.cjs'), '--import', 'tsx',
      'scripts/preload-v2.ts', 'worker', `--run-id=${runId}`, '--worker-id=fixture-worker', `--out=${out}`], {
      cwd: root, env: { ...process.env, PIPELINE_DATABASE_URL: assertTestDatabase(process.env['POSTGRES_PRISMA_URL']),
        TYPESAFE_API_KEY: 'fixture-private-key', V2_TEST_REAL_DATABASE: '1', V2_TEST_EVENTS: join(directory, 'events.jsonl'), ...extra }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr!.on('data', data => { stderr += String(data); });
    const done = new Promise<{ code: number | null; signal: string | null; stderr: string }>(resolve =>
      child.on('close', (code, signal) => resolve({ code, signal, stderr })));
    children.set(child, done); return { child, done, out };
  }
  function events(directory: string): { type: string; request?: unknown }[] {
    const path = join(directory, 'events.jsonl');
    // A provider process may currently be appending its next record.
    return existsSync(path) ? readFileSync(path, 'utf8').split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line)) : [];
  }
  async function waitPaused(directory: string) {
    const end = Date.now() + 15_000;
    while (Date.now() < end) { if (events(directory).some(e => e.type === 'paused')) return; await new Promise(resolve => setTimeout(resolve, 25)); }
    throw new Error('Worker did not reach the provider pause checkpoint');
  }
  async function cliFixture() {
    const id = identity(), directory = mkdtempSync(join(tmpdir(), 'hex-queue-cli-')); directories.push(directory);
    const scope = randomUUID();
    for (const suffix of ['a', 'b']) {
      const restaurantId = `hex-queue-${scope}-${suffix}`; restaurantIds.push(restaurantId);
      await db.restaurant.create({ data: { id: restaurantId, storeUuid: `${scope}-${suffix}`, name: `Queue fixture ${suffix} ${scope}`,
        address: 'Synthetic test', lat: 34.05, lng: -118.25, source: 'ue_feed', homeHex: hex, menuKind: 'restaurant' } });
    }
    await queue.enqueue(id);
    return { id, directory, runId: id.runId.replace('pipeline-v2-dev:queue:', ''), secondStore: `${scope}-b` };
  }

  test('SIGKILL recovery on a different worker replays durable paid responses and completes the real hex transaction', async () => {
    const { id, directory, runId, secondStore } = await cliFixture();
    const interrupted = startWorker(runId, directory, { V2_TEST_PAUSE_STORE: secondStore }); await waitPaused(directory);
    const active = (await db.hexJob.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } }))!;
    expect(events(directory).filter(e => e.type === 'jev_call')).toHaveLength(2);
    expect(await queue.claim(id.runId, 'competitor')).toBeNull();
    expect(await startWorker(runId, directory).done).toMatchObject({ code: 0, stderr: '' });
    expect(events(directory).filter(e => e.type === 'jev_call')).toHaveLength(2);
    interrupted.child.kill('SIGKILL'); expect((await interrupted.done).signal).toBe('SIGKILL');
    await expire(active);
    expect(await startWorker(runId, directory).done).toMatchObject({ code: 0, stderr: '' });
    expect(events(directory).filter(e => e.type === 'jev_call')).toHaveLength(4);
    expect(new Set(events(directory).filter(e => e.type === 'jev_call').map(e => JSON.stringify(e.request))).size).toBe(4);
    const finished = (await db.hexJob.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } }))!;
    expect(finished).toMatchObject({ status: 'completed', attempts: 2, leaseOwner: null, leaseExpiresAt: null });
    expect(await db.pipelineCompletedHex.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } })).toMatchObject({ count: 2 });
    const journal = await queue.events(finished) as { event: string; report?: { calls: { reusedJev: number } } }[];
    expect(journal.find(e => e.event === 'completed')?.report?.calls.reusedJev).toBe(2);
    expect(await db.menuItem.count({ where: { restaurantId: { in: restaurantIds } } })).toBe(2);
    expect(await startWorker(runId, directory).done).toMatchObject({ code: 0 });
    expect(events(directory).filter(e => e.type === 'jev_call')).toHaveLength(4);
  }, 60_000);

  test('a killed in-flight paid request parks unknown spend without ever issuing it again', async () => {
    const { id, directory, runId } = await cliFixture();
    const interrupted = startWorker(runId, directory, { V2_TEST_PAUSE_JEV: '1' }); await waitPaused(directory);
    interrupted.child.kill('SIGKILL'); await interrupted.done;
    const active = (await db.hexJob.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } }))!; await expire(active);
    expect(await startWorker(runId, directory).done).toMatchObject({ code: 1 });
    expect(events(directory).filter(e => e.type === 'jev_call')).toHaveLength(1);
    expect((await db.hexJob.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } }))?.status).toBe('failed');
    expect(await db.pipelineCompletedHex.findUnique({ where: { runId_hexId: { runId: id.runId, hexId: id.hexId } } })).toBeNull();
  }, 60_000);
});
