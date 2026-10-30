// Exercise the real auth, sync, RevenueCat parser, persistence and status paths.
// Only external boundaries (JWT verification, Prisma and HTTP) are mocked.
const mockJwtVerify = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdateMany = jest.fn();
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}));
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrismaClient: jest.fn(() => ({
    subscription: { findUnique: mockFindUnique, create: mockCreate, updateMany: mockUpdateMany },
    user: { findUnique: jest.fn(async () => ({ id: 'subscriber-uuid' })) },
  })),
}));

import { NextRequest } from 'next/server';
import { POST } from './route';
import type { SubscriptionRow } from '@/lib/subscription';

const env = process.env;
const realFetch = global.fetch;
const revenueCatUrl = 'https://api.revenuecat.com/v1/subscribers/subscriber-uuid';
let row: SubscriptionRow;
let expires: string;
let sandbox: boolean;
let revenueCatStatus: number;
let info: jest.SpyInstance;
let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-10-30T12:00:00Z') });
  process.env = {
    ...env,
    VERCEL_ENV: 'production',
    SUPABASE_URL: 'https://auth.example.test',
    REVENUECAT_PUBLIC_API_KEY: 'appl_fixture',
    UPSTASH_REDIS_REST_URL: 'https://quota.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fixture-token',
  };
  delete process.env['ALLOW_STUB_SUBSCRIPTIONS'];
  delete process.env['DEMO_REVIEW_EMAILS'];
  mockJwtVerify.mockResolvedValue({ payload: {
    sub: 'subscriber-uuid', email: 'subscriber@example.test', role: 'authenticated',
    app_metadata: { provider: 'apple' }, amr: [{ method: 'oauth' }],
  } });
  row = null;
  expires = new Date(Date.now() + 86_400_000).toISOString();
  sandbox = true;
  revenueCatStatus = 200;
  mockFindUnique.mockImplementation(async () => row);
  mockCreate.mockImplementation(async ({ data }: { data: NonNullable<SubscriptionRow> }) => {
    row = data;
    return row;
  });
  mockUpdateMany.mockImplementation(async ({ data }: { data: NonNullable<SubscriptionRow> }) => {
    row = { ...row!, ...data };
    return { count: 1 };
  });
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    if (url.toString() === 'https://quota.upstash.io/') return Response.json({ result: [1, 10, 0] });
    if (url !== revenueCatUrl) throw new Error('Unexpected external request');
    return Response.json({
      request_date_ms: Date.now(),
      subscriber: {
        entitlements: { pro: { expires_date: expires, product_identifier: 'monthly' } },
        subscriptions: { monthly: { is_sandbox: sandbox, original_transaction_id: 'fixture-transaction' } },
      },
    }, { status: revenueCatStatus });
  }) as typeof fetch;
  info = jest.spyOn(console, 'info').mockImplementation(() => {});
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = env;
  global.fetch = realFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const request = (reason = 'purchase', authenticated = true) => new NextRequest(
  'http://localhost/api/subscriptions/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { authorization: 'Bearer fixture-token' } : {}) },
    body: JSON.stringify({ reason, userId: 'untrusted-user-id', is_sandbox: true }),
  },
);

it.each(['purchase', 'restore', 'sign_in'])('confirms a production sandbox %s through the server re-check', async reason => {
  const response = await POST(request(reason));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ active: true, verdict: 'active', synced: true, stale: false, expiresAt: expires });
  expect(global.fetch).toHaveBeenCalledWith(revenueCatUrl, expect.objectContaining({
    headers: { authorization: 'Bearer appl_fixture', 'x-platform': 'ios' },
  }));
  expect(row).toMatchObject({ status: 'active', expiresAt: new Date(expires), lastEventAt: expect.any(Date) });
  expect(mockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'subscriber-uuid', appleTransactionId: 'fixture-transaction' }) });
  expect(info).toHaveBeenCalledWith(JSON.stringify({ event: 'revenuecat.sandbox_entitlement_accepted', userId: 'subscriber-uuid' }));
});

it.each([
  { reason: 'sign_in', storedStatus: 'active' },
  { reason: 'mismatch', storedStatus: 'active' },
  { reason: 'restore_history', storedStatus: 'active' },
  { reason: 'sign_in', storedStatus: null },
])('returns expired after a production sandbox $reason sync from $storedStatus', async ({ reason, storedStatus }) => {
  expires = new Date(Date.now() - 60_000).toISOString();
  row = storedStatus ? {
    status: storedStatus, expiresAt: new Date(expires), lastEventAt: new Date(Date.now() - 120_000),
  } : null;
  const response = await POST(request(reason));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    active: false, verdict: 'expired', synced: true, stale: false, expiresAt: expires,
    lastRcVerifiedAt: new Date().toISOString(),
  });
  expect(global.fetch).toHaveBeenCalledWith(revenueCatUrl, expect.objectContaining({
    headers: { authorization: 'Bearer appl_fixture', 'x-platform': 'ios' },
  }));
  expect(row).toMatchObject({ status: 'expired', expiresAt: new Date(expires), lastEventAt: new Date() });
  expect(info).toHaveBeenCalledWith(JSON.stringify({ event: 'revenuecat.sandbox_entitlement_expired', userId: 'subscriber-uuid' }));
  expect(info).not.toHaveBeenCalledWith(JSON.stringify({ event: 'revenuecat.sandbox_entitlement_accepted', userId: 'subscriber-uuid' }));
});

it('keeps a new sandbox purchase unconfirmed while the server still reports expired', async () => {
  expires = new Date(Date.now() - 60_000).toISOString();
  const pending = POST(request());
  await jest.runAllTimersAsync();
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ active: false, verdict: 'unknown', synced: false });
  expect(row).toBeNull();
  expect(mockCreate).not.toHaveBeenCalled();
  expect(info).not.toHaveBeenCalledWith(JSON.stringify({ event: 'revenuecat.sandbox_entitlement_accepted', userId: 'subscriber-uuid' }));
});

it('accepts a production store purchase without a sandbox acceptance log', async () => {
  sandbox = false;
  const response = await POST(request());
  expect(await response.json()).toMatchObject({ active: true, verdict: 'active', synced: true });
  expect(info).toHaveBeenCalledTimes(1); // Existing subscription status-change log only.
  expect(info).toHaveBeenCalledWith('[subscription] status none -> active (sync)');
});

it.each(['unavailable', 'test_store'])('retains unknown for a lapsed row when RevenueCat is %s', async failure => {
  const previous = {
    status: 'active', expiresAt: new Date(Date.now() - 60_000), lastEventAt: new Date(Date.now() - 120_000),
  };
  row = previous;
  if (failure === 'test_store') process.env['REVENUECAT_PUBLIC_API_KEY'] = 'test_fixture';
  else revenueCatStatus = 503;
  expect(await (await POST(request('sign_in'))).json()).toMatchObject({ active: false, verdict: 'unknown', synced: false, stale: true });
  expect(row).toBe(previous);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockUpdateMany).not.toHaveBeenCalled();
  expect(info).not.toHaveBeenCalled();
  if (failure === 'test_store') {
    expect(global.fetch).not.toHaveBeenCalledWith(revenueCatUrl, expect.anything());
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'revenuecat.test_store_lookup_unknown', userId: 'subscriber-uuid' }));
  }
});

it('requires authentication before consulting RevenueCat', async () => {
  expect((await POST(request('purchase', false))).status).toBe(401);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
});
