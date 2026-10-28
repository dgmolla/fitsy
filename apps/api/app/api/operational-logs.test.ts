import { inspect } from 'node:util';
import { NextRequest } from 'next/server';
import { useRateLimitTransport } from '@/tests/fixtures/rateLimitTransport';

const SENTINEL = 'PRIVATE_SENTINEL_575';
const ACCOUNT_ID = '57557557-5575-4575-8575-575575575575';
const mockIngest = jest.fn();
jest.mock('@axiomhq/js', () => ({
  Axiom: jest.fn(() => ({ ingest: mockIngest, flush: jest.fn(async () => {}) })),
}));
const mockDb = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  subscription: { findUnique: jest.fn() },
  $queryRaw: jest.fn(), $transaction: jest.fn(),
};
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'), PrismaClient: jest.fn(() => mockDb),
}));
jest.mock('jose', () => ({
  jwtVerify: jest.fn(async () => ({ payload: {
    sub: ACCOUNT_ID, email: `${SENTINEL}@example.test`, role: 'authenticated',
  } })),
  createRemoteJWKSet: jest.fn(),
}));

import { GET as search } from './restaurants/route';
import { GET as preview } from './restaurants/preview/route';
import { DELETE as deleteAccount } from './user/route';
import { POST as pushToken } from './user/push-token/route';

const transport = useRateLimitTransport();
let logs: jest.SpyInstance[];
beforeEach(() => {
  jest.clearAllMocks();
  process.env['VERCEL_ENV'] = 'preview';
  process.env['ALLOW_STUB_SUBSCRIPTIONS'] = 'true';
  process.env['SUPABASE_URL'] = 'https://auth.example.test';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'fixture-key';
  delete process.env['AXIOM_TOKEN'];
  const error = Object.assign(new Error(`${SENTINEL} Prisma query / provider body`), {
    code: SENTINEL, meta: { email: SENTINEL, password: SENTINEL, token: SENTINEL },
  });
  mockDb.$queryRaw.mockRejectedValue(error);
  mockDb.$transaction.mockRejectedValue(error);
  mockDb.user.update.mockRejectedValue(error);
  logs = ['error', 'warn', 'info', 'log'].map(level =>
    jest.spyOn(console, level as 'error').mockImplementation(() => {}));
});
afterEach(() => {
  const captured = inspect(logs.map(log => log.mock.calls), { depth: 10 });
  logs.forEach(log => log.mockRestore());
  expect(captured).not.toContain(SENTINEL);
  expect(captured).not.toContain(ACCOUNT_ID);
});

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost/api/${path}`, {
    method, headers: { authorization: 'Bearer fixture-token' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

it.each([
  ['restaurants?lat=34&lng=-118', search],
  ['restaurants/preview?lat=34&lng=-118', preview],
  ['restaurants?shuffle=1&lat=34&lng=-118&calories=600&protein=40', search],
] as const)('%s contains Prisma failures through the actual request and query path', async (path, handler) => {
  const response = await handler(request(path));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal server error' });
  expect(mockDb.$queryRaw).toHaveBeenCalled();
  expect(logs[0]).toHaveBeenCalledTimes(1);
});

it('contains a push-token persistence error', async () => {
  const response = await pushToken(request('user/push-token', 'POST', { token: SENTINEL }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Failed to save push token' });
  expect(logs[0]).toHaveBeenCalledTimes(1);
});

it('contains an account deletion transaction error', async () => {
  const response = await deleteAccount(request('user', 'DELETE'));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Failed to delete account' });
  expect(logs[0]).toHaveBeenCalledTimes(1);
});

it('keeps auth cleanup failures non-fatal without logging provider errors', async () => {
  mockDb.$transaction.mockResolvedValue(undefined);
  transport.mockImplementation(async url => {
    if (String(url).includes('quota.example.test')) return Response.json({ result: [1, 0, 0] });
    throw new Error(`${SENTINEL} provider credentials`);
  });
  const response = await deleteAccount(request('user', 'DELETE'));
  expect(response.status).toBe(204);
  expect(logs[1]).toHaveBeenCalledWith('[auth] provider_unavailable');
});

it('sends only filter presence and query length through the real telemetry caller', async () => {
  process.env['AXIOM_TOKEN'] = 'fixture-token';
  mockDb.$queryRaw.mockResolvedValue([]);
  const response = await search(request(`restaurants?lat=34&lng=-118&q=${SENTINEL}&cuisineType=${SENTINEL}`));
  expect(response.status).toBe(200);
  expect(mockIngest).toHaveBeenCalledWith('fitsy-pipeline', [expect.objectContaining({
    hasCuisineFilter: true, hasQuery: true, queryLength: SENTINEL.length,
  })]);
  expect(inspect(mockIngest.mock.calls, { depth: 10 })).not.toContain(SENTINEL);
});
