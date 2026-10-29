import { NextRequest } from 'next/server';

// The actual guards, subscription reconciliation and search selection run.
// Only external JWT, Prisma and provider HTTP boundaries are replaced.
const mockJwt = jest.fn();
const mockTokenFind = jest.fn();
const mockTokenUpsert = jest.fn();
const mockTokenDelete = jest.fn();
const mockSubscriptionFind = jest.fn();
const mockSubscriptionCreate = jest.fn();
const mockSubscriptionUpdate = jest.fn();
const mockQuery = jest.fn();
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: (...args: unknown[]) => mockJwt(...args) }));
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrismaClient: jest.fn(() => ({
    widgetToken: { findUnique: mockTokenFind, upsert: mockTokenUpsert, deleteMany: mockTokenDelete },
    subscription: { findUnique: mockSubscriptionFind, create: mockSubscriptionCreate, updateMany: mockSubscriptionUpdate },
    user: { findUnique: jest.fn(async () => ({ id: 'widget-user' })) }, $queryRaw: mockQuery,
  })),
}));

import { POST, DELETE } from './token/route';
import { GET as search } from '../restaurants/route';
import { GET as subscriptionStatus } from '../subscriptions/status/route';
import { widgetTokenHash } from '@/lib/widgetAuth';
import type { SubscriptionRow } from '@/lib/subscription';

const originalEnv = process.env;
const originalFetch = global.fetch;
const installationId = '01234567-0123-4567-89ab-0123456789ab';
type TokenRow = { userId: string; installationId: string; tokenHash: string; expiresAt: Date };
let tokens: TokenRow[];
let row: SubscriptionRow;
let subject: string;
const tokenRequest = (method = 'POST', body: unknown = { installationId }, authorization = 'Bearer app-session') => new NextRequest(
  'http://localhost/api/widget/token', { method, headers: { authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
);
const searchRequest = (token: string, query = 'shuffle=1&lat=34&lng=-118&calories=600&protein=40') => new NextRequest(
  `http://localhost/api/restaurants?${query}`, { headers: { authorization: `Widget ${token}` } },
);
async function issue(): Promise<string> {
  const response = await POST(tokenRequest());
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  return (await response.json() as { token: string }).token;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv, SUPABASE_URL: 'https://widget-fixture.supabase.co', REVENUECAT_PUBLIC_API_KEY: 'appl_fixture' };
  delete process.env['VERCEL_ENV']; delete process.env['VERCEL'];
  delete process.env['ALLOW_STUB_SUBSCRIPTIONS']; delete process.env['DEMO_REVIEW_EMAILS'];
  delete process.env['UPSTASH_REDIS_REST_URL']; delete process.env['UPSTASH_REDIS_REST_TOKEN'];
  tokens = []; subject = 'widget-user';
  row = { status: 'active', expiresAt: new Date(Date.now() + 86400_000), lastEventAt: new Date() };
  mockJwt.mockImplementation(async (token: string) => {
    if (token !== 'app-session') throw new Error('Invalid signature');
    return { payload: { sub: subject, email: `${subject}@example.test`, role: 'authenticated',
      app_metadata: { provider: 'apple' }, amr: [{ method: 'oauth' }] } };
  });
  mockTokenUpsert.mockImplementation(async ({ create }: { create: TokenRow }) => {
    tokens = tokens.filter(token => token.userId !== create.userId || token.installationId !== create.installationId);
    tokens.push(create); return create;
  });
  mockTokenFind.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => {
    const token = tokens.find(token => token.tokenHash === where.tokenHash);
    return token ? { ...token, user: { id: token.userId, email: `${token.userId}@example.test` } } : null;
  });
  mockTokenDelete.mockImplementation(async ({ where }: { where: { userId: string; installationId: string } }) => {
    tokens = tokens.filter(token => token.userId !== where.userId || token.installationId !== where.installationId);
    return { count: 1 };
  });
  mockSubscriptionFind.mockImplementation(async () => row);
  mockSubscriptionCreate.mockImplementation(async ({ data }: { data: NonNullable<SubscriptionRow> }) => { row = data; return row; });
  mockSubscriptionUpdate.mockImplementation(async ({ data }: { data: NonNullable<SubscriptionRow> }) => { row = data; return { count: 1 }; });
  mockQuery.mockResolvedValue([{ restaurantId: 'restaurant', name: 'Test bowls', address: 'Fixture',
    lat: 34, lng: -118, distanceMiles: 0, cuisineTags: [], dietaryOptions: [], chainFlag: false,
    photoUrl: null, rating: null, priceLevel: null, menuItemId: 'dish', itemName: 'Chicken bowl',
    calories: 600, proteinG: 40, carbsG: 60, fatG: 20, confidence: 'HIGH', source: 'merchant', scoreSum: 0, orderKey: 0 }]);
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('upstash.io')) return new Response(JSON.stringify({ result: [1, 1, 0] }));
    return new Response(JSON.stringify({ request_date_ms: Date.now(), subscriber: {
      entitlements: { pro: { expires_date: new Date(Date.now() + 86400_000).toISOString(), product_identifier: 'monthly' } },
      subscriptions: { monthly: { store: 'app_store', is_sandbox: true } },
    } }));
  }) as typeof fetch;
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => { process.env = originalEnv; global.fetch = originalFetch; jest.restoreAllMocks(); });

it('issues random capabilities, persists only their digest, and rotates per device', async () => {
  const first = await issue(), second = await issue();
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(second).not.toBe(first);
  expect(tokens).toHaveLength(1);
  expect(tokens[0]).toMatchObject({ tokenHash: widgetTokenHash(second), userId: subject, installationId });
  expect(JSON.stringify(tokens)).not.toContain(second);
  expect(tokens[0]!.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400_000);
  expect((await search(searchRequest(first))).status).toBe(401);
});

it('uses the same real shuffle search and subscription rules', async () => {
  const result = await search(searchRequest(await issue()));
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ meta: { locked: false }, data: [{ bestMatch: { menuItemId: 'dish', proteinG: 40 } }] });
  expect(global.fetch).not.toHaveBeenCalled();
});

it.each(['lat=34&lng=-118', 'shuffle=1&lat=34&lng=-118&cursor=anything'])('rejects requests outside widget scope: %s', async query => {
  expect((await search(searchRequest(await issue(), query))).status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
});

it('cannot read account state, mint tokens, or revoke tokens with a widget credential', async () => {
  const token = await issue();
  const request = new NextRequest('http://localhost/api/subscriptions/status', { headers: { authorization: `Widget ${token}` } });
  expect((await subscriptionStatus(request)).status).toBe(401);
  expect((await POST(tokenRequest('POST', { installationId }, `Widget ${token}`))).status).toBe(401);
  expect((await DELETE(tokenRequest('DELETE', { installationId }, `Widget ${token}`))).status).toBe(401);
  expect(mockTokenDelete).not.toHaveBeenCalled();
});

it('expires and revokes a device capability without revoking other accounts', async () => {
  const token = await issue();
  tokens[0]!.expiresAt = new Date(Date.now() - 1);
  expect((await search(searchRequest(token))).status).toBe(401);
  const fresh = await issue();
  subject = 'other-user';
  expect((await DELETE(tokenRequest('DELETE'))).status).toBe(200);
  expect((await search(searchRequest(fresh))).status).toBe(200);
  subject = 'widget-user';
  expect((await DELETE(tokenRequest('DELETE'))).status).toBe(200);
  expect((await search(searchRequest(fresh))).status).toBe(401);
});

it.each([{}, { installationId: 'bad' }, null])('rejects malformed installation input: %j', async body => {
  expect((await POST(tokenRequest('POST', body))).status).toBe(400);
  expect(mockTokenUpsert).not.toHaveBeenCalled();
});

it('keeps the RevenueCat backend re-check, including sandbox entitlement in production mode', async () => {
  process.env['VERCEL_ENV'] = 'production';
  process.env['UPSTASH_REDIS_REST_URL'] = 'https://widget-fixture.upstash.io';
  process.env['UPSTASH_REDIS_REST_TOKEN'] = 'fixture-redis-token';
  // The persisted denial predates this provider snapshot, even on a fast clock.
  row = { status: 'never_subscribed', expiresAt: null, lastEventAt: new Date(Date.now() - 1000) };
  const token = await issue();
  const response = await search(searchRequest(token));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ meta: { locked: false }, data: [{ bestMatch: { menuItemId: 'dish' } }] });
  expect(global.fetch).toHaveBeenCalledWith('https://api.revenuecat.com/v1/subscribers/widget-user', expect.objectContaining({
    headers: { authorization: 'Bearer appl_fixture', 'x-platform': 'ios' },
  }));
  expect(row).toMatchObject({ status: 'active', lastEventAt: expect.any(Date) });
});

it('removes all dish data after RevenueCat confirms expiration', async () => {
  const token = await issue();
  row = { status: 'expired', expiresAt: new Date(Date.now() - 1000), lastEventAt: new Date() };
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ subscriber: { entitlements: {} } }))) as typeof fetch;
  const response = await search(searchRequest(token));
  expect(await response.json()).toMatchObject({ meta: { locked: true }, data: [{ bestMatch: null }] });
});
