import { PrismaClient } from '@prisma/client';
import { latLngToCell } from 'h3-js';
import { CloudRuns } from './cloud-runs';
import { CLOUD_RUN_PREFIX, CloudRunBudget, RunBudgetExceeded } from './cloud-budget';
import { HexJobQueue, LeaseLostError } from './queue';
import { DailyBudgetExceeded, SharedServiceBudget } from './service-budget';
import { assertTestDatabase } from '../lib/test-database-guard';

const databaseUrl = process.env['POSTGRES_PRISMA_URL'];
const suite = databaseUrl ? describe : describe.skip;
suite('cloud runs with real PostgreSQL, shared caps and independent worker connections', () => {
  const url = databaseUrl ? new URL(assertTestDatabase(databaseUrl)) : undefined;
  url?.searchParams.set('connection_limit', '1');
  const clients = Array.from({ length: 4 }, () => url
    ? new PrismaClient({ datasources: { db: { url: assertTestDatabase(url.toString()) } } }) : new PrismaClient());
  const db = clients[0]!, runs = new CloudRuns(db, 'cloud-fixture'), prefix = CLOUD_RUN_PREFIX + 'cloud-db-';
  const hexIds = [34.05, 34.08, 34.11].map(lat => latLngToCell(lat, -118.25, 7));
  const request = { runId: 'cloud-db-test', hexIds, maxHexes: 2, budgetUsd: 0.03 };
  const runId = CLOUD_RUN_PREFIX + request.runId;
  async function clean() {
    await db.$executeRaw`DELETE FROM public.pipeline_paid_requests`;
    await db.$executeRaw`DELETE FROM public.pipeline_service_days`;
    await db.$executeRaw`DELETE FROM public.hex_jobs WHERE starts_with(run_id,${prefix})`;
    await db.$executeRaw`DELETE FROM public.pipeline_runs WHERE starts_with(run_id,${prefix})`;
    await new SharedServiceBudget(db).configure('jev',5,100000);
  }
  beforeAll(async () => { await Promise.all(clients.map(client => client.$connect())); }, 15_000);
  beforeEach(clean);
  afterAll(async () => { try { await clean(); } finally { await Promise.all(clients.map(client => client.$disconnect())); } });

  test('start atomically enqueues at most the explicit hex bound; repeated starts preserve spend and identity', async () => {
    const state = await runs.start(request);
    expect(state).toMatchObject({ runId, status:'running', selectedHexes:2, maxHexes:2, budgetUsd:0.03 });
    const budget = new CloudRunBudget(db,runId), permit = await budget.reserve('jev',0.01,'first');
    await budget.settle(permit,0.005);
    expect(await new CloudRuns(clients[1]!,'cloud-fixture').start(request)).toMatchObject({ costUsd:0.005, reservedUsd:0 });
    await expect(runs.start({ ...request, budgetUsd:1 })).rejects.toThrow('limits changed');
    await expect(runs.start({ ...request, runId:'cloud-db-overlap' })).rejects.toThrow('active');
    expect(await db.hexJob.count({ where:{ runId } })).toBe(2);
  });
  test('independent starts cannot create two active refreshes', async () => {
    const results = await Promise.allSettled(clients.map((client,i) => new CloudRuns(client,'cloud-fixture').start({ ...request, runId:'cloud-db-race-' + i })));
    expect(results.filter(result => result.status==='fulfilled')).toHaveLength(1);
    expect(await db.$queryRaw`SELECT run_id FROM public.pipeline_runs WHERE status='running'`).toHaveLength(1);
  });
  test('rollout priorities survive cloud start, determine the next claim, and cannot change on replay', async () => {
    const prioritized = { ...request, priorities: [1, 100, 0] };
    await runs.start(prioritized);
    expect(await new HexJobQueue(clients[1]!).claim(runId, 'metro-first')).toMatchObject({ hexId: hexIds[1], priority: 100 });
    expect(await runs.start(prioritized)).toMatchObject({ selectedHexes: 2 });
    await expect(runs.start({ ...request, priorities: [100, 1, 0] })).rejects.toThrow('limits changed');
    expect(await db.hexJob.findUnique({ where: { runId_hexId: { runId, hexId: hexIds[1]! } } })).toMatchObject({ priority: 100 });
  });
  test('concurrent replicas cannot multiply a run budget; known charges and restart never reset it', async () => {
    await runs.start(request);
    const budgets = clients.map(client => new CloudRunBudget(client,runId));
    const results = await Promise.allSettled(Array.from({ length:32 },(_,i) => budgets[i%4]!.reserve('jev',0.01,'request-' + i)));
    const admitted = results.filter((result): result is PromiseFulfilledResult<string> => result.status==='fulfilled');
    expect(admitted).toHaveLength(3);
    expect(results.filter(result => result.status==='rejected').every(result => result.reason instanceof RunBudgetExceeded)).toBe(true);
    expect(await runs.state(runId)).toMatchObject({ costUsd:0, reservedUsd:0.03 });
    await Promise.all(admitted.map(result => budgets[0]!.settle(result.value,0.01)));
    await expect(new CloudRunBudget(clients[3]!,runId).reserve('jev',0.01,'after-restart')).rejects.toBeInstanceOf(RunBudgetExceeded);
    expect(await runs.state(runId)).toMatchObject({ status:'budget_cap', costUsd:0.03, reservedUsd:0 });
    expect(await new HexJobQueue(db).claim(runId,'extra-worker')).toBeNull();
  },15_000);
  test('daily denial does not charge the run; unknown reservations remain charged after restart', async () => {
    await runs.start(request);
    const daily = new SharedServiceBudget(db), budget = new CloudRunBudget(db,runId);
    await daily.configure('jev',0.01,100);
    const prior = await daily.reserve('jev',0.01,'other-run');
    await expect(budget.reserve('jev',0.01,'daily-denied')).rejects.toBeInstanceOf(DailyBudgetExceeded);
    expect(await runs.state(runId)).toMatchObject({ costUsd:0,reservedUsd:0 });
    await daily.settle(prior,0);
    const permit = await budget.reserve('jev',0.01,'unknown');
    await budget.settle(permit,null);
    expect(await runs.state(runId)).toMatchObject({ costUsd:0,reservedUsd:0.01 });
    await expect(new CloudRunBudget(clients[2]!,runId).reserve('jev',0.03,'restart')).rejects.toBeInstanceOf(RunBudgetExceeded);
    await expect(new CloudRunBudget(db,runId+'-wrong').settle(permit,0)).rejects.toThrow();
    await budget.settle(permit,0.002);
    await expect(budget.settle(permit,0)).rejects.toThrow();
    expect(await runs.state(runId)).toMatchObject({ costUsd:0.002,reservedUsd:0 });
  });
  test('graceful scale-down releases the lease immediately, preserving its journal and fencing the old token', async () => {
    // Use one job: release makes it eligible now, without priority over older pending jobs.
    await runs.start({ ...request, maxHexes: 1 });
    const queue = new HexJobQueue(db), job = (await queue.claim(runId,'old-replica'))!;
    await queue.append(job,{ event:'source',sourceHash:'retained' });
    await queue.release(job);
    const replacement = (await new HexJobQueue(clients[1]!).claim(runId,'new-replica'))!;
    expect(replacement.hexId).toBe(job.hexId); expect(replacement.attempts).toBe(1);
    expect(await queue.events(replacement)).toContainEqual({ event:'source',sourceHash:'retained' });
    await expect(queue.release(job)).rejects.toBeInstanceOf(LeaseLostError);
    await expect(queue.append(job,{ event:'late' })).rejects.toBeInstanceOf(LeaseLostError);
    await queue.release(replacement,true);
    expect(await db.hexJob.findUnique({ where:{ runId_hexId:{ runId,hexId:job.hexId } } })).toMatchObject({ status:'failed',leaseOwner:null });
  });
  test('zero budget starts stopped, and completion prevents more claims without changing worker code', async () => {
    expect(await runs.start({ ...request,budgetUsd:0 })).toMatchObject({ status:'budget_cap',selectedHexes:2 });
    expect(await new HexJobQueue(db).claim(runId,'idle')).toBeNull();
    const second = await runs.start({ ...request,runId:'cloud-db-finished' });
    await db.$executeRaw`UPDATE public.hex_jobs SET status='completed' WHERE run_id=${second.runId}`;
    expect(await runs.refresh(second.runId)).toMatchObject({ status:'completed',completedHexes:2 });
    expect(await new HexJobQueue(db).claim(second.runId,'extra')).toBeNull();
  });
  test('only pipeline can write run limits/accounting and only audit can read besides pipeline', async () => {
    await runs.start(request);
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE pipeline_writer');
      const budget = new CloudRunBudget(tx,runId), id = await budget.reserve('jev',0.01,'role'); await budget.settle(id,0);
    });
    for (const role of ['fitsy_app','anon','authenticated','fitsy_audit_readonly']) {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE ' + role);
        await tx.$executeRaw`UPDATE public.pipeline_runs SET budget_usd=99 WHERE run_id=${runId}`;
      })).rejects.toThrow();
    }
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE fitsy_audit_readonly');
      expect(await tx.$queryRaw`SELECT run_id FROM public.pipeline_runs WHERE run_id=${runId}`).toHaveLength(1);
    });
    const [table] = await db.$queryRaw<{ rls:boolean; exposed:bigint }[]>`SELECT c.relrowsecurity AS rls,
      (SELECT COUNT(*) FROM aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE a.grantee=0 OR r.rolname IN ('anon','authenticated','fitsy_app')) AS exposed
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='pipeline_runs'`;
    expect(table).toEqual({ rls:true,exposed:0n });
  });
});
