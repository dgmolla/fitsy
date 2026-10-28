import { PrismaClient } from '@prisma/client';
import { latLngToCell } from 'h3-js';
import { DailyBudgetExceeded, SharedServiceBudget } from './service-budget';
import { HexJobQueue } from './queue';
import { PdfJobQueue } from './pdf-queue';
import { reservationUsd } from './journal';
import { assertTestDatabase } from '../lib/test-database-guard';

const databaseUrl = process.env['POSTGRES_PRISMA_URL'];
const suite = databaseUrl ? describe : describe.skip;
suite('fleet budgets with real PostgreSQL and independent workers', () => {
  // Keep eight independent worker sessions within the disposable database's connection budget.
  const workerUrl = databaseUrl ? new URL(assertTestDatabase(databaseUrl)) : undefined;
  workerUrl?.searchParams.set('connection_limit', '1');
  const clients = Array.from({ length: 8 }, () => new PrismaClient(workerUrl ? { datasources: { db: { url: workerUrl.toString() } } } : undefined));
  const db = clients[0]!, budgets = clients.map(client => new SharedServiceBudget(client));
  const runId = 'pipeline-v2-dev:queue:budget-regression', brandId = 'budget-pdf-brand';
  beforeAll(async () => { await Promise.all(clients.map(client => client.$connect())); }, 15_000);
  beforeEach(async () => {
    await db.$executeRaw`DELETE FROM public.pipeline_paid_requests`;
    await db.$executeRaw`DELETE FROM public.pipeline_service_days`;
    await db.$executeRaw`DELETE FROM public.hex_jobs WHERE run_id=${runId}`;
    await db.brand.upsert({ where: { id: brandId }, update: {}, create: { id: brandId, displayName: 'Budget PDF Brand', slug: brandId, detectionConf: 'high' } });
    await db.$executeRaw`DELETE FROM public.pipeline_pdf_jobs WHERE brand_id=${brandId}`;
    await budgets[0]!.configure('jev', 5, 100000); await budgets[0]!.configure('google',5,1000); await budgets[0]!.configure('pdf_finder',0,10);
  });
  afterAll(async () => {
    try {
      await db.$executeRaw`DELETE FROM public.pipeline_paid_requests`;
      await db.$executeRaw`DELETE FROM public.pipeline_service_days`;
      await db.$executeRaw`DELETE FROM public.hex_jobs WHERE run_id=${runId}`;
      await db.brand.deleteMany({ where: { id: brandId } });
      await budgets[0]!.configure('jev',5,100000); await budgets[0]!.configure('google',5,1000); await budgets[0]!.configure('pdf_finder',0,10);
    } finally { await Promise.all(clients.map(client => client.$disconnect())); }
  }, 15_000);

  test.each(['jev','google'] as const)('%s in-flight calls cannot overshoot the daily cap across workers', async service => {
    await budgets[0]!.configure(service, 0.03, 100);
    // Every accepted call remains in flight until all contenders have attempted admission.
    const results = await Promise.allSettled(Array.from({ length: 32 }, (_,i) => budgets[i % budgets.length]!.reserve(service,0.01,`request-${i}`)));
    const accepted = results.filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled');
    expect(accepted).toHaveLength(3);
    const denied = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(denied.every(result => result.reason instanceof DailyBudgetExceeded)).toBe(true);
    expect((await budgets[1]!.state()).find(state => state.service===service)).toMatchObject({ costUsd: 0, reservedUsd: 0.03, calls: '3' });
    await Promise.all(accepted.map(result => budgets[2]!.settle(result.value,0.01)));
    await expect(budgets[3]!.reserve(service,0.01,'after-settlement')).rejects.toBeInstanceOf(DailyBudgetExceeded);
  }, 15_000);

  test('partial settlement releases only unused capacity; uncertain charges survive restart and UTC rollover', async () => {
    await budgets[0]!.configure('google',0.04,100);
    const unknown = await budgets[0]!.reserve('google',0.032,'old-day');
    await budgets[0]!.settle(unknown,null,true);
    // Move the accounting day together, simulating an unresolved previous-day request.
    await db.$executeRaw`UPDATE public.pipeline_paid_requests SET day=day-1 WHERE id=${unknown}::uuid`;
    await db.$executeRaw`UPDATE public.pipeline_service_days SET day=day-1 WHERE service='google'`;
    const restarted = new SharedServiceBudget(clients[5]!);
    await expect(restarted.reserve('google',0.032,'new-day')).rejects.toBeInstanceOf(DailyBudgetExceeded);
    const photo = await restarted.reserve('google',0.007,'new-day-photo');
    await restarted.settle(photo,0.001);
    expect((await restarted.state()).find(row => row.service==='google')).toMatchObject({ reservedUsd:0.032, costUsd:0.001, calls:'1' });
    await expect(restarted.settle(photo,0)).rejects.toThrow();
  });

  test('claim admission stops without consuming attempts, and daily exhaustion during work defers rather than fails', async () => {
    const hex = latLngToCell(34.05,-118.25,7), queue = new HexJobQueue(db);
    await queue.enqueue({ runId, hexId:hex, target:'fixture' });
    await budgets[0]!.configure('jev',0,100);
    expect(await queue.claim(runId,'worker')).toBeNull();
    await budgets[0]!.configure('jev',0.000688127,100);
    expect(await queue.claim(runId,'worker')).toBeNull();
    await expect(budgets[0]!.reserve('jev',reservationUsd,'insufficient-envelope')).rejects.toBeInstanceOf(DailyBudgetExceeded);
    await budgets[0]!.configure('jev',0.000688128,100);
    const job = (await queue.claim(runId,'worker'))!;
    expect(job).not.toBeNull();
    const permit = await budgets[1]!.reserve('jev',reservationUsd,'competing-worker');
    expect((await budgets[0]!.state()).find(row => row.service==='jev')).toMatchObject({ reservedUsd:0.000688128,calls:'1' });
    expect(await new HexJobQueue(clients[2]!).claim(runId,'another')).toBeNull();
    await expect(budgets[0]!.reserve('jev',reservationUsd,'current-job')).rejects.toBeInstanceOf(DailyBudgetExceeded);
    await queue.deferBudget(job);
    const [saved] = await db.$queryRaw<{ status:string; attempts:number; deferred:boolean }[]>`SELECT status,attempts,
      next_retry_at>clock_timestamp() AS deferred FROM public.hex_jobs WHERE run_id=${runId} AND hex_id=${hex}`;
    expect(saved).toEqual({ status:'pending',attempts:0,deferred:true });
    await budgets[1]!.settle(permit,0);
  });

  test('free PDF research has a fleet-wide daily attempt cap and cannot be reset by worker startup', async () => {
    await budgets[0]!.configure('pdf_finder',0,2);
    const queue = new PdfJobQueue(db); await queue.enqueue(brandId);
    const results = await Promise.allSettled(budgets.map((budget,i) => budget.reserve('pdf_finder',0,`pdf-${i}`)));
    expect(results.filter(result => result.status==='fulfilled')).toHaveLength(2);
    expect(await queue.claim('pdf-worker')).toBeNull();
    expect((await new SharedServiceBudget(clients[6]!).state()).find(row => row.service==='pdf_finder')).toMatchObject({ calls:'2',costUsd:0 });
  });

  test('pipeline-only writes and audit-only reads retain default-deny RLS and no client grants', async () => {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE pipeline_writer');
      const budget = new SharedServiceBudget(tx);
      const permit = await budget.reserve('jev',reservationUsd,'role-test'); await budget.settle(permit,0);
    });
    for (const role of ['anon','authenticated','fitsy_app','fitsy_audit_readonly']) {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        await new SharedServiceBudget(tx).reserve('google',0.01,'denied');
      })).rejects.toThrow();
    }
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE fitsy_audit_readonly');
      expect(await new SharedServiceBudget(tx).state()).toHaveLength(3);
    });
    const rows = await db.$queryRaw<{ rls:boolean; exposed:bigint }[]>`SELECT c.relrowsecurity AS rls,
      (SELECT COUNT(*) FROM aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
       WHERE a.grantee=0 OR r.rolname IN ('anon','authenticated')) AS exposed
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname IN ('pipeline_service_budgets','pipeline_service_days','pipeline_paid_requests')`;
    expect(rows).toHaveLength(3); expect(rows.every(row => row.rls && row.exposed===0n)).toBe(true);
  });
});
