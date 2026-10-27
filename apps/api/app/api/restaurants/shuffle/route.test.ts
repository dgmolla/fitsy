// Exercise the real route, gate, RevenueCat parser, synchronization and selection.
// Only external boundaries (JWT provider, database client and HTTP) are mocked.
const mockVerifyToken = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdateMany = jest.fn();
const mockQueryRaw = jest.fn();
jest.mock('@/services/authService', () => ({ verifyToken: (...args: unknown[]) => mockVerifyToken(...args) }));
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrismaClient: jest.fn(() => ({
    subscription: { findUnique: mockFindUnique, create: mockCreate, updateMany: mockUpdateMany },
    user: { findUnique: jest.fn(async () => ({ id: 'subscriber-uuid' })) },
    $queryRaw: mockQueryRaw,
  })),
}));

import { NextRequest } from 'next/server';
import { shuffleResponseSchema } from '@fitsy/shared';
import { GET } from './route';
import type { SubscriptionRow } from '@/lib/subscription';

const env = process.env;
const realFetch = global.fetch;
let row: SubscriptionRow;
let serial = 0;
const request = (authenticated = true) => new NextRequest(
  `http://localhost/api/restaurants/shuffle?lat=21&lng=-41&calories=600&protein=40&seed=regression-${serial++}`,
  { headers: authenticated ? { authorization: 'Bearer fixture-token' } : {} },
);
const responseBody = async (requestToSend = request()) => {
  const response = await GET(requestToSend);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  return shuffleResponseSchema.parse(await response.json());
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...env, REVENUECAT_PUBLIC_API_KEY: 'test_fixture' };
  delete process.env['ALLOW_STUB_SUBSCRIPTIONS'];
  delete process.env['DEMO_REVIEW_EMAILS'];
  mockVerifyToken.mockResolvedValue({ sub: 'subscriber-uuid', email: 'subscriber@example.test' });
  row = { status: 'active', expiresAt: new Date(Date.now() + 86_400_000), lastEventAt: new Date(Date.now() - 1000) };
  mockFindUnique.mockImplementation(async () => row);
  mockCreate.mockImplementation(async ({ data }: { data: NonNullable<SubscriptionRow> }) => { row = data; return row; });
  mockUpdateMany.mockImplementation(async ({ data }: { data: NonNullable<SubscriptionRow> }) => {
    row = { ...row!, ...data }; return { count: 1 };
  });
  mockQueryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('SELECT r.*') ? [{
    id: 'restaurant', name: 'Test bowls', address: 'Fixture', lat: 21, lng: -41, distanceMiles: 0,
    cuisineTags: [], dietaryOptions: [], chainFlag: false, photoUrl: null, rating: null, priceLevel: null,
    openingHours: null,
  }] : [{ id: 'dish', restaurantId: 'restaurant', name: 'Chicken bowl', calories: 600, proteinG: 40,
    carbsG: 60, fatG: 20, confidence: 'HIGH', source: 'merchant', scoreSum: 0 }]);
  global.fetch = jest.fn(async () => new Response(JSON.stringify({
    request_date_ms: Date.now(), subscriber: {
      original_app_user_id: '$RCAnonymousID:before-login',
      entitlements: { pro: { expires_date: new Date(Date.now() + 86_400_000).toISOString(), product_identifier: 'monthly' } },
      subscriptions: { monthly: { store: process.env['REVENUECAT_PUBLIC_API_KEY']?.startsWith('test_') ? 'test_store' : 'app_store',
        is_sandbox: process.env['REVENUECAT_PUBLIC_API_KEY']?.startsWith('test_') } },
    },
  }))) as typeof fetch;
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = env;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

it('returns a complete dish for a subscriber with fresh proof without a RevenueCat read', async () => {
  const result = await responseBody();
  expect(result.meta.locked).toBe(false);
  expect(result.data?.item).toEqual({ id: 'dish', name: 'Chicken bowl' });
  expect(result.data?.macros).toMatchObject({ calories: 600, proteinG: 40, confidence: 'HIGH' });
  expect(global.fetch).not.toHaveBeenCalled();
});

it.each(['test_fixture', 'appl_fixture'])('reconciles stale subscriber proof before locking with %s', async key => {
  process.env['REVENUECAT_PUBLIC_API_KEY'] = key;
  row!.lastEventAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const result = await responseBody();
  expect(result.meta.locked).toBe(false);
  expect(result.data?.item?.id).toBe('dish');
  expect(global.fetch).toHaveBeenCalledWith('https://api.revenuecat.com/v1/subscribers/subscriber-uuid', expect.objectContaining({
    headers: { authorization: `Bearer ${key}`, 'x-platform': 'ios', ...(key.startsWith('test_') ? { 'x-is-sandbox': 'true' } : {}) },
  }));
  expect(row).toMatchObject({ status: 'active', lastEventAt: expect.any(Date) });
});

it('recovers missing proof and a renewal whose old period has ended', async () => {
  for (const previous of [null, { status: 'active', expiresAt: new Date(Date.now() - 1000), lastEventAt: new Date(Date.now() - 2000) }]) {
    row = previous;
    const result = await responseBody();
    expect(result.meta.locked).toBe(false);
    expect(result.data?.macros?.proteinG).toBe(40);
  }
});

it('rejects anonymous callers and keeps RevenueCat-confirmed expired users locked', async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify({
    request_date_ms: Date.now(), subscriber: { entitlements: {
      pro: { expires_date: new Date(Date.now() - 1000).toISOString(), product_identifier: 'monthly' },
    } },
  }))) as typeof fetch;
  expect((await GET(request(false))).status).toBe(401);
  for (const authenticated of [true]) {
    row!.status = 'expired';
    const result = await responseBody(request(authenticated));
    expect(result.meta.locked).toBe(true);
    expect(result.data?.item).toBeNull();
    expect(result.data?.macros).toBeNull();
  }
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('repairs a previously persisted denial when RevenueCat confirms a current entitlement', async () => {
  row!.status = 'never_subscribed';
  const result = await responseBody();
  expect(result.meta.locked).toBe(false);
  expect(result.data?.item?.id).toBe('dish');
});

it('does not consult subscriber state for an invalid token', async () => {
  mockVerifyToken.mockRejectedValueOnce(new Error('invalid token'));
  expect((await GET(request())).status).toBe(401);
  expect(mockFindUnique).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('fails closed without overwriting proof when RevenueCat is unavailable', async () => {
  row!.lastEventAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const previous = { ...row! };
  global.fetch = jest.fn(async () => new Response('{}', { status: 503 })) as typeof fetch;
  const result = await responseBody();
  expect(result.meta.locked).toBe(true);
  expect(result.data?.item).toBeNull();
  expect(row).toEqual(previous);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockUpdateMany).not.toHaveBeenCalled();
});

it('does not return a cached paid dish after RevenueCat confirms expiration', async () => {
  const sameRequest = request();
  expect((await responseBody(sameRequest)).meta.locked).toBe(false);
  row!.status = 'expired';
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ subscriber: { entitlements: {} } }))) as typeof fetch;
  const result = await responseBody(sameRequest);
  expect(result.meta.locked).toBe(true);
  expect(result.data?.item).toBeNull();
  expect(result.data?.macros).toBeNull();
});

it('honors a newer expiration webhook instead of granting the older active REST snapshot', async () => {
  row!.status = 'expired';
  mockUpdateMany.mockImplementation(async () => {
    row = { status: 'expired', expiresAt: null, lastEventAt: new Date(Date.now() + 1000) };
    return { count: 0 };
  });
  expect((await responseBody()).meta.locked).toBe(true);
});

it('does not grant an unpersisted RevenueCat result to a deleted account', async () => {
  row = null;
  const { prisma } = jest.requireActual('@/lib/restaurantService') as typeof import('@/lib/restaurantService');
  jest.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(null);
  expect((await responseBody()).meta.locked).toBe(true);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('enforces the user rate limit before any RevenueCat reconciliation, including cache hits', async () => {
  mockVerifyToken.mockResolvedValue({ sub: 'rate-limited-uuid', email: 'limited@example.test' });
  row = null;
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ subscriber: { entitlements: {} } }))) as typeof fetch;
  const sameRequest = request();
  for (let i = 0; i < 30; i++) expect((await responseBody(sameRequest)).meta.locked).toBe(true);
  const calls = (global.fetch as jest.Mock).mock.calls.length;
  const limited = await GET(sameRequest);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(global.fetch).toHaveBeenCalledTimes(calls);
});
