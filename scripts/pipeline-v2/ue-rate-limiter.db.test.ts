import { PrismaClient } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchStoreV1, __resetUeCircuitBreakerForTest } from '../../apps/api/services/menuSources/ueApiClient';
import { SharedUeRateLimiter } from './ue-rate-limiter';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
suite('shared UE bucket (real PostgreSQL, independent workers, only provider HTTP substituted)', () => {
  const clients = Array.from({ length: 4 }, () => new PrismaClient());
  const db = clients[0]!, gates = clients.map(client => new SharedUeRateLimiter(client));
  const http = jest.spyOn(global, 'fetch');
  let logs: jest.SpyInstance;
  const reset = () => db.$executeRaw`UPDATE public.pipeline_ue_rate_limit SET cap_rps = 5, effective_rps = 5,
    next_request_at = clock_timestamp(), blocked_until = clock_timestamp(), recover_after = clock_timestamp() + interval '1 minute',
    requests = 0, waits = 0, throttles = 0, last_throttle_at = NULL, last_throttle_status = NULL WHERE singleton = true`;
  beforeEach(async () => {
    await reset(); http.mockReset(); __resetUeCircuitBreakerForTest();
    logs = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => { logs.mockRestore(); await reset(); });
  afterAll(async () => { http.mockRestore(); await Promise.all(clients.map(client => client.$disconnect())); });

  test('N independent workers share the configured cap for all HTTP attempts without accumulating idle bursts', async () => {
    // Observe committed grants inside PostgreSQL, before client/HTTP scheduling jitter.
    // Keep this fixture out of the public schema inspected by concurrent security suites.
    await db.$executeRaw`CREATE SCHEMA ue_rate_limiter_test`;
    try {
      await db.$executeRaw`CREATE TABLE ue_rate_limiter_test.grants (request bigint PRIMARY KEY, admitted_at timestamptz NOT NULL)`;
      await db.$executeRaw`CREATE FUNCTION ue_rate_limiter_test.record_grant() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO ue_rate_limiter_test.grants VALUES (NEW.requests, NEW.updated_at);
          -- Delay the first reply beyond the old 20ms allowance, without changing its grant time.
          IF NEW.requests = 1 THEN PERFORM pg_sleep(0.15); END IF;
          RETURN NEW;
        END; $$`;
      await db.$executeRaw`CREATE TRIGGER record_ue_rate_grant AFTER UPDATE ON public.pipeline_ue_rate_limit
        FOR EACH ROW WHEN (NEW.requests > OLD.requests) EXECUTE FUNCTION ue_rate_limiter_test.record_grant()`;
      const grantTimes = () => db.$queryRaw<{ atUs: bigint }[]>`SELECT
        (EXTRACT(EPOCH FROM admitted_at) * 1000000)::bigint AS "atUs" FROM ue_rate_limiter_test.grants ORDER BY request`;
      const expectPaced = (grants: { atUs: bigint }[], count: number) => {
        expect(grants).toHaveLength(count);
        // Capacity one permits one initial token plus refills, with no timing tolerance.
        for (let i = 0; i < grants.length; i++) for (let j = i + 1; j < grants.length; j++) {
          expect(grants[j]!.atUs - grants[i]!.atUs).toBeGreaterThanOrEqual(BigInt(j - i) * 200_000n);
        }
      };
      http.mockImplementation(async () => Response.json({ status: 'success' }));
      const results = await Promise.all(Array.from({ length: 16 }, (_, i) =>
        fetchStoreV1(`worker-${i}`, { rateLimiter: gates[i % gates.length]!, maxRetries: 0 })));
      expect(results).toEqual(Array(16).fill({ status: 'success' }));
      expect(http).toHaveBeenCalledTimes(16);
      expectPaced(await grantTimes(), 16);
      expect(await gates[0]!.state()).toMatchObject({ capRps: 5, requests: 16n });
      await db.$executeRaw`UPDATE public.pipeline_ue_rate_limit SET next_request_at = clock_timestamp() - interval '1 hour'`;
      await Promise.all(gates.map(gate => gate.acquire()));
      const grants = await grantTimes();
      expect(grants).toHaveLength(20);
      expectPaced(grants.slice(16), 4);
      expect((await gates[0]!.state()).requests).toBe(20n);
    } finally {
      // Dropping the function also removes its trigger on the singleton.
      await db.$executeRaw`DROP SCHEMA ue_rate_limiter_test CASCADE`;
    }
  }, 15_000);

  test('a final-attempt 429 backs off every worker, including one already waiting for a token', async () => {
    http.mockResolvedValueOnce(new Response('throttled', { status: 429, headers: { 'Retry-After': '120' } }));
    expect(await fetchStoreV1('worker-a', { rateLimiter: gates[0]!, maxRetries: 0 })).toBeNull();
    const state = await gates[1]!.state();
    expect(state).toMatchObject({ capRps: 5, effectiveRps: 2.5, requests: 1n, throttles: 1n });
    const [timing] = await db.$queryRaw<{ seconds: number }[]>`SELECT EXTRACT(EPOCH FROM (blocked_until - clock_timestamp()))::float8 AS seconds FROM public.pipeline_ue_rate_limit`;
    expect(timing!.seconds).toBeGreaterThan(115); expect(timing!.seconds).toBeLessThanOrEqual(120);
    const controller = new AbortController();
    const waiting = fetchStoreV1('worker-b', { rateLimiter: gates[1]!, maxRetries: 0, signal: controller.signal });
    await delay(100);
    expect(http).toHaveBeenCalledTimes(1);
    expect((await gates[2]!.state()).waits).toBe(1n);
    controller.abort(); expect(await waiting).toBeNull();

    // A worker that began waiting before the throttle must recheck shared state on wake.
    await reset(); await gates[0]!.acquire();
    const second = new AbortController(); let admitted = false;
    const pending = gates[1]!.acquire(second.signal).then(() => { admitted = true; }, () => {});
    try {
      await delay(30); await gates[2]!.throttle(429, null); await delay(250);
      expect(admitted).toBe(false);
      expect((await gates[3]!.state()).requests).toBe(1n);
    } finally { second.abort(); await pending; }
  });

  test('concurrent 403/429 signals never lose counters or rate reductions and honor HTTP-date Retry-After', async () => {
    const [clock] = await db.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() + interval '15 minutes' AS at`;
    await Promise.all(gates.map((gate, i) => gate.throttle(i % 2 ? 403 : 429, clock!.at.toUTCString())));
    const state = await gates[0]!.state();
    expect(state).toMatchObject({ effectiveRps: 5 / 16, throttles: 4n });
    expect(state.blockedUntil.getTime()).toBeGreaterThanOrEqual(clock!.at.getTime() - 1000);
    expect(logs.mock.calls.filter(([message]) => String(message).startsWith('{'))).toHaveLength(4);
  });

  test('recovery waits through cooldown plus a quiet minute, adds one bounded step and never exceeds the cap', async () => {
    await gates[0]!.throttle(429, null);
    await db.$executeRaw`UPDATE public.pipeline_ue_rate_limit SET blocked_until = clock_timestamp(), next_request_at = clock_timestamp()`;
    await gates[1]!.acquire(); expect((await gates[0]!.state()).effectiveRps).toBe(2.5);
    for (let step = 1; step <= 12; step++) {
      await db.$executeRaw`UPDATE public.pipeline_ue_rate_limit SET recover_after = clock_timestamp() - interval '1 hour', next_request_at = clock_timestamp()`;
      await gates[step % gates.length]!.acquire();
      expect((await gates[0]!.state()).effectiveRps).toBe(Math.min(5, 2.5 + step * 0.25));
      await db.$executeRaw`UPDATE public.pipeline_ue_rate_limit SET next_request_at = clock_timestamp()`;
      await gates[0]!.acquire();
      expect((await gates[1]!.state()).effectiveRps).toBe(Math.min(5, 2.5 + step * 0.25));
    }
  });

  test('operator cap changes affect every instance and preserve active backoff and cumulative metrics', async () => {
    await gates[0]!.throttle(429, null);
    const previous = await gates[0]!.state();
    await gates[1]!.configure(0.2);
    expect(await gates[2]!.state()).toMatchObject({ capRps: 0.2, effectiveRps: 0.2, throttles: 1n, blockedUntil: previous.blockedUntil });
    await gates[3]!.configure(10);
    expect(await new SharedUeRateLimiter(db).state()).toMatchObject({ capRps: 10, effectiveRps: 0.2, throttles: 1n, blockedUntil: previous.blockedUntil });
  });

  test('the singleton is protected by RLS, pipeline-only updates and audit-only reads', async () => {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE pipeline_writer');
      const gate = new SharedUeRateLimiter(tx);
      await gate.acquire(); await gate.throttle(403, null);
      expect((await gate.state()).throttles).toBe(1n);
    });
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE fitsy_audit_readonly');
      expect((await new SharedUeRateLimiter(tx).state()).throttles).toBe(1n);
    });
    for (const role of ['fitsy_app', 'fitsy_audit_readonly', 'pipeline_writer']) {
      const denied = role === 'fitsy_app' ? 'SELECT * FROM public.pipeline_ue_rate_limit'
        : role === 'pipeline_writer' ? 'DELETE FROM public.pipeline_ue_rate_limit WHERE false'
          : 'UPDATE public.pipeline_ue_rate_limit SET cap_rps=1 WHERE false';
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`); await tx.$queryRawUnsafe(denied);
      })).rejects.toMatchObject({ meta: { code: '42501' } });
    }
    const [security] = await db.$queryRaw<{ rls: boolean; exposed: bigint }[]>`SELECT c.relrowsecurity AS rls,
      (SELECT COUNT(*) FROM aclexplode(c.relacl) acl LEFT JOIN pg_roles r ON r.oid=acl.grantee
        WHERE acl.grantee=0 OR r.rolname IN ('anon', 'authenticated')) AS exposed
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='pipeline_ue_rate_limit'`;
    expect(security).toEqual({ rls: true, exposed: 0n });
    await expect(db.$executeRaw`INSERT INTO public.pipeline_ue_rate_limit (singleton) VALUES (false)`).rejects.toMatchObject({ meta: { code: '23514' } });
  });
});
