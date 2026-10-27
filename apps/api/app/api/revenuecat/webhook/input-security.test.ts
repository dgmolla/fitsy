import { inspect } from 'node:util';
import { AUTH, EVENT_MS, event, makeRequest } from './fixtures';

jest.mock('jose', () => ({ jwtVerify: jest.fn(), createRemoteJWKSet: jest.fn() }));
jest.mock('@/lib/restaurantService', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    subscription: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  },
}));

import { POST } from './route';
import { prisma } from '@/lib/restaurantService';

const SENTINEL = 'PRIVATE_SENTINEL_575';
const originalEnv = { ...process.env };
let logs: jest.SpyInstance[];
let transport: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  process.env['REVENUECAT_WEBHOOK_AUTH'] = AUTH;
  process.env['REVENUECAT_PUBLIC_API_KEY'] = 'fixture-key';
  process.env['VERCEL_ENV'] = 'preview';
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: SENTINEL });
  (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.subscription.create as jest.Mock).mockResolvedValue({});
  (prisma.subscription.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  logs = ['error', 'warn', 'info', 'log'].map(level =>
    jest.spyOn(console, level as 'error').mockImplementation(() => {}));
  transport = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ secret: SENTINEL }, { status: 503 }));
});

afterEach(() => {
  const captured = inspect(logs.map(log => log.mock.calls), { depth: 10 });
  logs.forEach(log => log.mockRestore());
  transport.mockRestore();
  process.env = { ...originalEnv };
  expect(captured).not.toContain(SENTINEL);
});

it.each([
  { aliases: SENTINEL }, { aliases: [null] }, { aliases: [{ secret: SENTINEL }] },
  { aliases: Array(101).fill(SENTINEL) }, { app_user_id: [SENTINEL] },
  { app_user_id: SENTINEL.repeat(100) }, { product_id: { secret: SENTINEL } },
  { entitlement_ids: 'pro' }, { entitlement_ids: ['pro', { secret: SENTINEL }] },
  { expiration_at_ms: '2099-01-01' }, { expiration_at_ms: 8.64e15 + 1 },
  { expiration_at_ms: -1 }, { expiration_at_ms: 0 }, { expiration_at_ms: 1.5 },
  { event_timestamp_ms: SENTINEL }, { event_timestamp_ms: 1e100 },
  { original_transaction_id: { secret: SENTINEL } },
  { type: 'TRANSFER', transferred_from: SENTINEL, transferred_to: [SENTINEL] },
  { type: 'TRANSFER', transferred_from: [null], transferred_to: [SENTINEL] },
  { type: 'TRANSFER', transferred_from: [], transferred_to: Array(101).fill(SENTINEL) },
])('rejects malformed modeled fields before lookup or persistence (%#)', async fields => {
  const response = await POST(makeRequest(event(fields), AUTH));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: expect.any(String) });
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
  expect(prisma.subscription.create).not.toHaveBeenCalled();
  expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it.each([null, [], { event: [] }, { event: { type: [SENTINEL] } }, { event: null }])(
  'rejects malformed envelopes without side effects (%#)', async body => {
    const response = await POST(makeRequest(body, AUTH));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid webhook payload' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  },
);

it('bounds even unmodeled events and extensions before parsing or acknowledging', async () => {
  const response = await POST(makeRequest(event({ type: 'FUTURE', secret: SENTINEL.repeat(20_000) }), AUTH));
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: 'Request body too large' });
  expect(transport).not.toHaveBeenCalled();
});

it('preserves the null timestamp fallback for a modeled event', async () => {
  const before = Date.now();
  const response = await POST(makeRequest(event({ event_timestamp_ms: null }), AUTH));
  expect(response.status).toBe(200);
  const applied = (prisma.subscription.create as jest.Mock).mock.calls[0][0].data.lastEventAt as Date;
  expect(applied.getTime()).toBeGreaterThanOrEqual(before);
  expect(applied.getTime()).toBeLessThanOrEqual(Date.now());
});

it('acknowledges future events with unmodeled provider fields without processing them', async () => {
  process.env['VERCEL_ENV'] = 'production';
  const response = await POST(makeRequest({ api_version: '1.0', event: {
    type: 'FUTURE_EVENT', subscriber_attributes: { secret: SENTINEL }, aliases: { future: true },
  } }, AUTH));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true });
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it('accepts lifetime expiry, provider extensions and alias resolution without logging identity', async () => {
  const response = await POST(makeRequest(event({
    app_user_id: '$RCAnonymousID:fixture', aliases: [SENTINEL],
    expiration_at_ms: null, subscriber_attributes: { email: { value: SENTINEL } },
  }), AUTH));
  expect(response.status).toBe(200);
  expect(prisma.subscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    userId: SENTINEL, expiresAt: null, lastEventAt: new Date(EVENT_MS),
  }) });
  expect(logs[2]).toHaveBeenCalled();
});

it('returns safe retryable errors on stale conflicts without logging identity or row values', async () => {
  (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
    status: SENTINEL, expiresAt: new Date(EVENT_MS + 1), lastEventAt: new Date(EVENT_MS + 100),
  });
  const response = await POST(makeRequest(event({ app_user_id: SENTINEL }), AUTH));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'RevenueCat lookup unresolved' });
  expect(transport).toHaveBeenCalledTimes(1);
});

it('preserves transfer retries and expires the old owner when the provider fails', async () => {
  transport.mockRejectedValue(new Error(`${SENTINEL} provider request`));
  const response = await POST(makeRequest(event({
    type: 'TRANSFER', transferred_from: [SENTINEL], transferred_to: [`new-${SENTINEL}`],
  }), AUTH));
  expect(response.status).toBe(500);
  expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
    where: { userId: SENTINEL }, data: { status: 'expired', lastEventAt: expect.any(Date) },
  });
});
