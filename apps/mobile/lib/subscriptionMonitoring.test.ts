jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null) } }));
const mockCapture = jest.fn();
jest.mock('posthog-react-native', () => ({ __esModule: true, default: jest.fn(() => ({ capture: mockCapture })) }));

import { fetchSubscriptionStatus, syncSubscription } from './apiClient';
import { sanitizeAnalyticsEvent } from './analyticsPrivacy';

const originalFetch = global.fetch;
beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { global.fetch = originalFetch; });

test.each(['status', 'sync'])('a real %s request returning 503 emits a safe PostHog server-error outcome', async source => {
  global.fetch = jest.fn(async () => Response.json({ error: 'private-provider-body' }, { status: 503 }));
  const request = source === 'status' ? fetchSubscriptionStatus() : syncSubscription('purchase');
  await expect(request).rejects.toMatchObject({ status: 503 });
  expect(mockCapture).toHaveBeenCalledWith('subscription_check', expect.objectContaining({ source, outcome: 'server_error', status_code: 503, duration_ms: expect.any(Number) }));
  expect(JSON.stringify(mockCapture.mock.calls)).not.toContain('private-provider-body');
});

test.each(['active', 'expired', 'unknown'])('successful %s answers supply the rate denominator', async verdict => {
  global.fetch = jest.fn(async () => Response.json({ active: verdict === 'active', verdict }));
  await fetchSubscriptionStatus();
  expect(mockCapture).toHaveBeenCalledWith('subscription_check', expect.objectContaining({ outcome: verdict === 'unknown' ? 'unknown' : 'known', status_code: 200 }));
});

test('network failures remain distinct and privacy filtering retains only operational metadata', async () => {
  global.fetch = jest.fn(async () => { throw new Error('private-network-detail'); });
  await expect(fetchSubscriptionStatus()).rejects.toThrow('private-network-detail');
  expect(mockCapture).toHaveBeenCalledWith('subscription_check', expect.objectContaining({ outcome: 'network_error', status_code: 0 }));
  const event = sanitizeAnalyticsEvent({ event: 'subscription_check', properties: {
    source: 'status', outcome: 'server_error', status_code: 503, duration_ms: 21, kind: 'production',
    email: 'person@example.test', token: 'private-token', message: 'private-provider-body',
  } });
  expect(event?.properties).toEqual({ source: 'status', outcome: 'server_error', status_code: 503, duration_ms: 21, kind: 'production' });
});
