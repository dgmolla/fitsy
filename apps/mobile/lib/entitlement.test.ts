/**
 * @jest-environment node
 */
const mockSyncSubscription = jest.fn();
const mockFetchSubscriptionStatus = jest.fn();
const store: Record<string, string> = {};

jest.mock('./apiClient', () => ({
  syncSubscription: (...args: unknown[]) => mockSyncSubscription(...args),
  fetchSubscriptionStatus: (...args: unknown[]) => mockFetchSubscriptionStatus(...args),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ENTITLEMENT_CACHE_KEY,
  clearCachedEntitlement,
  fetchServerEntitlement,
  readCachedEntitlement,
  writeCachedEntitlement,
} from './entitlement';

beforeEach(() => {
  mockSyncSubscription.mockReset();
  mockFetchSubscriptionStatus.mockReset();
  for (const k of Object.keys(store)) delete store[k];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('fetchServerEntitlement', () => {
  it('boot reads the stored row (cheap) instead of re-reading RevenueCat', async () => {
    const status = { active: true, status: 'active', expiresAt: null, verdict: 'active', lastRcVerifiedAt: '2026-09-29T06:00:00Z', stale: false };
    mockFetchSubscriptionStatus.mockResolvedValue(status);
    expect(await fetchServerEntitlement('boot')).toEqual(status);
    expect(mockSyncSubscription).not.toHaveBeenCalled();
  });

  it.each(['purchase', 'restore', 'sign_in', 'mismatch'] as const)('%s re-reads RevenueCat via sync, telling the server why', async (reason) => {
    const status = { active: false, synced: true, verdict: 'expired', lastRcVerifiedAt: '2026-09-29T06:00:00Z', stale: false };
    mockSyncSubscription.mockResolvedValue(status);
    expect(await fetchServerEntitlement(reason)).toEqual(status);
    expect(mockSyncSubscription).toHaveBeenCalledWith(reason);
    expect(mockFetchSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('never throws - a failed request resolves to null so the caller keeps its current verdict', async () => {
    mockFetchSubscriptionStatus.mockRejectedValue(new Error('boom'));
    mockSyncSubscription.mockRejectedValue(new Error('boom'));
    expect(await fetchServerEntitlement('boot')).toBeNull();
    expect(await fetchServerEntitlement('mismatch')).toBeNull();
  });

  it('rejects a status without the shared verdict instead of treating it as never subscribed', async () => {
    mockFetchSubscriptionStatus.mockResolvedValue({ active: false, status: null });
    expect(await fetchServerEntitlement('boot')).toBeNull();
  });
});

describe('entitlement cache', () => {
  const proof = (verdict: 'active' | 'expired' | 'never_subscribed') => ({
    active: verdict === 'active', verdict, status: verdict, stale: false,
    expiresAt: verdict === 'active' ? new Date(Date.now() + 60_000).toISOString() : null,
    lastRcVerifiedAt: new Date().toISOString(),
  });

  it('round-trips a bounded account-bound verdict and rejects missing or mismatched accounts', async () => {
    expect(await readCachedEntitlement('u1')).toBeNull();
    await writeCachedEntitlement('u1', proof('active'));
    expect(await readCachedEntitlement('u1')).toEqual(expect.objectContaining({ verdict: 'active', active: true }));
    expect(await readCachedEntitlement('u2')).toBeNull();
    await writeCachedEntitlement('u1', proof('expired'));
    expect(await readCachedEntitlement('u1')).toEqual(expect.objectContaining({ verdict: 'expired', active: false }));
    store[ENTITLEMENT_CACHE_KEY] = 'garbage';
    expect(await readCachedEntitlement('u1')).toBeNull();
    await clearCachedEntitlement();
    expect(await readCachedEntitlement('u1')).toBeNull();
  });

  it('rejects an expired paid period even when its last RC proof is recent', async () => {
    await writeCachedEntitlement('u1', { ...proof('active'), expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await readCachedEntitlement('u1')).toBeNull();
  });

  it('swallows storage failures (a broken cache only costs a slower boot)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    expect(await readCachedEntitlement('u1')).toBeNull();
    await expect(writeCachedEntitlement('u1', proof('active'))).resolves.toBeUndefined();
    await expect(clearCachedEntitlement()).resolves.toBeUndefined();
  });
});
