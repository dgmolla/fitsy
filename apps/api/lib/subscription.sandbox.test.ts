// Exercise the real RevenueCat parser and server gate in production mode.
// Only external HTTP and persistence are replaced; no entitlement stub.
const mockFind = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/lib/restaurantService', () => ({ prisma: {
  user: { findUnique: jest.fn().mockResolvedValue({ id: 'sandbox-account' }) },
  subscription: { findUnique: (...args: unknown[]) => mockFind(...args), create: (...args: unknown[]) => mockCreate(...args) },
} }));
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn() }));
jest.mock('@/lib/widgetAuth', () => ({ requireWidgetSearchAuth: jest.fn() }));
import { getEntitlementStatus, syncSubscriptionFromRevenueCat } from './subscription';

const originalEnv = process.env;
const originalFetch = global.fetch;
afterEach(() => { process.env = originalEnv; global.fetch = originalFetch; jest.restoreAllMocks(); });

test('production mode admits a genuinely verified TestFlight/App Review sandbox entitlement through the ordinary gate', async () => {
  process.env = { ...originalEnv, NODE_ENV: 'production', VERCEL_ENV: 'production', REVENUECAT_PUBLIC_API_KEY: 'appl_fixture' };
  delete process.env['ALLOW_STUB_SUBSCRIPTIONS']; delete process.env['DEMO_REVIEW_EMAILS'];
  const expiresAt = new Date(Date.now() + 3_600_000), verifiedAt = new Date();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
    request_date_ms: verifiedAt.getTime(), subscriber: {
      entitlements: { pro: { expires_date: expiresAt.toISOString(), product_identifier: 'monthly' } },
      subscriptions: { monthly: { is_sandbox: true, store: 'app_store', original_transaction_id: 'sandbox-tx' } },
    },
  }) });
  jest.spyOn(console, 'info').mockImplementation(() => {});
  mockFind.mockResolvedValueOnce(null);
  mockCreate.mockResolvedValue({});
  expect(await syncSubscriptionFromRevenueCat('sandbox-account')).toBe(true);
  expect(mockCreate).toHaveBeenCalledWith({ data: {
    userId: 'sandbox-account', status: 'active', plan: 'monthly', expiresAt,
    appleTransactionId: 'sandbox-tx', lastEventAt: verifiedAt,
  } });
  mockFind.mockResolvedValueOnce({ status: 'active', expiresAt, lastEventAt: verifiedAt });
  expect(await getEntitlementStatus('sandbox-account', 'sandbox@fitsy.dev')).toMatchObject({
    active: true, verdict: 'active', stale: false, expiresAt, lastRcVerifiedAt: verifiedAt,
  });
  expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    headers: { authorization: 'Bearer appl_fixture', 'x-platform': 'ios' },
  }));
});
