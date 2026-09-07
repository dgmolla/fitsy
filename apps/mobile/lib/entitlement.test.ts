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
    mockFetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    expect(await fetchServerEntitlement('boot')).toBe(true);
    expect(mockSyncSubscription).not.toHaveBeenCalled();
  });

  it.each(['purchase', 'restore', 'sign_in', 'mismatch'] as const)('%s re-reads RevenueCat via sync, telling the server why', async (reason) => {
    mockSyncSubscription.mockResolvedValue({ active: false, synced: true });
    expect(await fetchServerEntitlement(reason)).toBe(false);
    expect(mockSyncSubscription).toHaveBeenCalledWith(reason);
    expect(mockFetchSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('never throws - a failed request resolves to null so the caller keeps its current verdict', async () => {
    mockFetchSubscriptionStatus.mockRejectedValue(new Error('boom'));
    mockSyncSubscription.mockRejectedValue(new Error('boom'));
    expect(await fetchServerEntitlement('boot')).toBeNull();
    expect(await fetchServerEntitlement('mismatch')).toBeNull();
  });
});

describe('entitlement cache', () => {
  it('round-trips both verdicts and is null when unset or unreadable', async () => {
    expect(await readCachedEntitlement()).toBeNull();
    await writeCachedEntitlement(true);
    expect(store[ENTITLEMENT_CACHE_KEY]).toBe('true');
    expect(await readCachedEntitlement()).toBe(true);
    await writeCachedEntitlement(false);
    expect(await readCachedEntitlement()).toBe(false);
    store[ENTITLEMENT_CACHE_KEY] = 'garbage';
    expect(await readCachedEntitlement()).toBeNull();
    await clearCachedEntitlement();
    expect(await readCachedEntitlement()).toBeNull();
  });

  it('swallows storage failures (a broken cache only costs a slower boot)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    expect(await readCachedEntitlement()).toBeNull();
    await expect(writeCachedEntitlement(true)).resolves.toBeUndefined();
    await expect(clearCachedEntitlement()).resolves.toBeUndefined();
  });
});
