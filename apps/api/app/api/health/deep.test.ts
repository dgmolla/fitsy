const mockQuery = jest.fn();
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'), PrismaClient: jest.fn(() => ({ $queryRaw: mockQuery })),
}));

import { NextRequest } from 'next/server';
import { GET } from './route';

const originalEnv = process.env;
const originalFetch = global.fetch;
let failing: string | null;

beforeEach(() => {
  process.env = { ...originalEnv, VERCEL_ENV: 'production', CRON_SECRET: 'fixture-cron',
    UPSTASH_REDIS_REST_URL: 'https://quota.example.test', UPSTASH_REDIS_REST_TOKEN: 'fixture-token',
    REVENUECAT_PUBLIC_API_KEY: 'appl_fixture',
  };
  mockQuery.mockReset().mockResolvedValue([]);
  failing = null;
  global.fetch = jest.fn(async url => {
    if (String(url) === 'https://quota.example.test/') {
      return Response.json(failing === 'upstash' ? { error: 'private-provider-detail' } : { result: 'PONG' }, { status: failing === 'upstash' ? 503 : 200 });
    }
    if (url === 'https://api.revenuecat.com/v1/subscribers/fitsy-health-probe') return new Response(null, { status: failing === 'revenuecat' ? 503 : 401 });
    throw new Error('Unexpected external request');
  }) as typeof fetch;
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { process.env = originalEnv; global.fetch = originalFetch; jest.restoreAllMocks(); jest.useRealTimers(); });
const request = (token = 'fixture-cron') => new NextRequest('https://fitsy.org/api/health?deep=1', { headers: { authorization: `Bearer ${token}` } });

test('deep health authenticates before touching any dependency', async () => {
  expect((await GET(request('wrong'))).status).toBe(401);
  delete process.env['CRON_SECRET'];
  expect((await GET(request())).status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('deep health pings the store without billed EVAL, exercises the DB, and checks RC without creating a customer', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok', dependencies: { upstash: 'ok', supabase: 'ok', revenuecat: 'ok' } });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith('https://api.revenuecat.com/v1/subscribers/fitsy-health-probe', expect.objectContaining({ redirect: 'error' }));
  const storeCalls = JSON.stringify((global.fetch as jest.Mock).mock.calls);
  expect(storeCalls).toContain('PING');
  expect(storeCalls).not.toContain('EVAL');
});

test.each(['supabase', 'upstash', 'revenuecat'])('%s failure yields a non-200 deep health result without provider details', async dependency => {
  failing = dependency;
  if (dependency === 'supabase') mockQuery.mockRejectedValue(new Error('private-database-password'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.dependencies[dependency]).toBe('unavailable');
  expect(JSON.stringify(body)).not.toMatch(/private|password|token/);
});

test('pool exhaustion is bounded even if acquiring a connection never settles', async () => {
  jest.useFakeTimers();
  mockQuery.mockReturnValue(new Promise(() => {}));
  const response = GET(request());
  await jest.advanceTimersByTimeAsync(2_001);
  expect((await response).status).toBe(503);
});

test('the store probe sends only an unbilled PING and fails closed on anything but PONG', async () => {
  const { pingSharedStore } = await import('../../../lib/dependencyHealth');
  await expect(pingSharedStore()).resolves.toBeUndefined();
  for (const bad of [new Response('', { status: 503 }), Response.json({ error: 'provider error' }), Response.json({ result: 'nope' }), Response.json({})]) {
    global.fetch = jest.fn(async () => bad.clone()) as typeof fetch;
    await expect(pingSharedStore()).rejects.toThrow();
  }
  global.fetch = jest.fn(async () => { throw new Error('network down'); }) as typeof fetch;
  await expect(pingSharedStore()).rejects.toThrow();
});
