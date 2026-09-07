/**
 * PurchasesProvider: the sync decision logic around `entitled`.
 *
 * The native seam (`./purchases`), the API transport (`./apiClient`), the
 * Supabase session, analytics, and AsyncStorage are all mocked; what runs
 * for real is the provider plus `./entitlement`, so these tests pin down
 * WHO decides (the server), what happens while it can't (cache, then the
 * device as a last resort), and which reason hits which endpoint.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

type Info = { entitlements: { active: Record<string, unknown>; all: Record<string, unknown> } };
const proInfo: Info = { entitlements: { active: { pro: {} }, all: { pro: {} } } };
const freeInfo: Info = { entitlements: { active: {}, all: {} } };

// jest.mock factories are hoisted above these declarations and run at the
// mocked module's first require, so they must not touch the mock objects
// then. Each factory returns a proxy that looks the member up at call time.
function mockLazy<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get: (_target, key) => {
      const target = get() as Record<PropertyKey, unknown>;
      const value = target[key];
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

const mockRc = {
  configurePurchases: jest.fn(() => true),
  identifyPurchasesUser: jest.fn(async () => freeInfo),
  fetchCustomerInfo: jest.fn(async () => freeInfo),
  fetchCurrentOffering: jest.fn(async () => null),
  addCustomerInfoListener: jest.fn(() => () => undefined),
  logoutPurchasesUser: jest.fn(async () => undefined),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
  presentPaywall: jest.fn(),
  presentCustomerCenter: jest.fn(),
  isProActive: (info: Info | null) => !!info && info.entitlements.active['pro'] !== undefined,
  hasLapsedEntitlement: (info: Info | null) =>
    !!info && info.entitlements.active['pro'] === undefined && info.entitlements.all['pro'] !== undefined,
};
jest.mock('./purchases', () => mockLazy(() => mockRc));

const mockApi = {
  syncSubscription: jest.fn(),
  fetchSubscriptionStatus: jest.fn(),
};
jest.mock('./apiClient', () => mockLazy(() => mockApi));

let mockSession: { user: { id: string } } | null = { user: { id: 'u1' } };
let mockAuthListener: ((event: string, session: unknown) => void) | undefined;
jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mockAuthListener = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  },
}));

const mockAnalytics = {
  trackEntitlementMismatch: jest.fn(),
  trackEntitlementSyncFailed: jest.fn(),
  trackPaywallShown: jest.fn(),
  trackPaywallResult: jest.fn(),
  trackPurchasesRestored: jest.fn(),
  trackCustomerCenterOpened: jest.fn(),
};
jest.mock('./analytics', () => mockLazy(() => mockAnalytics));

const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStore[key] ?? null,
    setItem: async (key: string, value: string) => { mockStore[key] = value; },
    removeItem: async (key: string) => { delete mockStore[key]; },
  },
}));

import { ENTITLEMENT_CACHE_KEY } from './entitlement';
import { PurchasesProvider, usePurchases } from './usePurchases';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PurchasesProvider>{children}</PurchasesProvider>
);
const render = () => renderHook(() => usePurchases(), { wrapper });

/** A promise the test resolves by hand, to hold the server mid-flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockSession = { user: { id: 'u1' } };
  mockAuthListener = undefined;
  mockRc.identifyPurchasesUser.mockResolvedValue(freeInfo);
  mockRc.fetchCustomerInfo.mockResolvedValue(freeInfo);
  mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: null, expiresAt: null });
  mockApi.syncSubscription.mockResolvedValue({ active: false, synced: true });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('boot', () => {
  it('reads the stored verdict (status, not sync), stores it, caches it, and only then becomes ready', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = render();
    expect(result.current.ready).toBe(false);
    expect(result.current.entitled).toBeNull();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    expect(mockApi.fetchSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    // Device (free) disagreed with the server (active): measured.
    expect(mockAnalytics.trackEntitlementMismatch).toHaveBeenCalledWith({
      reason: 'boot', device_pro: false, server_active: true,
    });
  });

  it('hydrates from the cache for instant UI, then lets the server overrule it', async () => {
    mockStore[ENTITLEMENT_CACHE_KEY] = 'true';
    const pending = deferred<{ active: boolean; status: null; expiresAt: null }>();
    mockApi.fetchSubscriptionStatus.mockReturnValue(pending.promise);
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    await act(async () => { pending.resolve({ active: false, status: null, expiresAt: null }); });
    await waitFor(() => expect(result.current.entitled).toBe(false));
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('false');
  });

  it('falls back to the device verdict only when offline with no cache (subscriber not bounced)', async () => {
    mockApi.fetchSubscriptionStatus.mockRejectedValue(new Error('offline'));
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    expect(result.current.isPro).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBeUndefined();
    expect(mockAnalytics.trackEntitlementSyncFailed).toHaveBeenCalledWith({ reason: 'boot' });
  });

  it('offline with a cache keeps the cache, not the device', async () => {
    mockStore[ENTITLEMENT_CACHE_KEY] = 'false';
    mockApi.fetchSubscriptionStatus.mockRejectedValue(new Error('offline'));
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    // Give the failed boot sync a chance to (wrongly) apply the fallback.
    await act(async () => { await new Promise((r) => setImmediate(r)); });
    expect(result.current.entitled).toBe(false);
  });

  it('without a session is not entitled and never asks the server', async () => {
    mockSession = null;
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(false);
    expect(mockApi.fetchSubscriptionStatus).not.toHaveBeenCalled();
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
  });

  it('still resolves a verdict when the SDK has no key (Expo Go, web)', async () => {
    mockRc.configurePurchases.mockReturnValueOnce(false);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(true);
    expect(mockRc.identifyPurchasesUser).not.toHaveBeenCalled();
  });
});

describe('syncEntitlement', () => {
  it('leaves the verdict unchanged and returns null when the server cannot be asked', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = render();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    mockApi.syncSubscription.mockRejectedValue(new Error('boom'));
    let verdict: boolean | null = true;
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBeNull();
    expect(result.current.entitled).toBe(true);
    expect(mockAnalytics.trackEntitlementSyncFailed).toHaveBeenCalledWith({ reason: 'mismatch' });
  });

  it('non-boot reasons make the server re-read RevenueCat and the verdict flips', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    let verdict: boolean | null = null;
    await act(async () => { verdict = await result.current.syncEntitlement('mismatch'); });
    expect(verdict).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockApi.syncSubscription).toHaveBeenCalledTimes(1);
  });
});

describe('purchase / restore', () => {
  it('a confirmed purchase resolves true and is entitled immediately; a server "false" (REST lag) never downgrades it', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(false);
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'purchased', customerInfo: proInfo });
    mockApi.syncSubscription.mockResolvedValue({ active: false, synced: true });
    let got: boolean | undefined;
    await act(async () => { got = await result.current.purchase({} as never, 'test'); });
    // payment.tsx does `if (!isPro) return`: a charged user must get in.
    expect(got).toBe(true);
    expect(result.current.isPro).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    expect(mockAnalytics.trackEntitlementMismatch).toHaveBeenCalledWith({
      reason: 'purchase', device_pro: true, server_active: false,
    });
  });

  it('a purchase whose sync stalls or fails still leaves the user entitled', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitled).toBe(false);
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'purchased', customerInfo: proInfo });
    mockApi.syncSubscription.mockRejectedValue(new Error('offline'));
    let got: boolean | undefined;
    await act(async () => { got = await result.current.purchase({} as never, 'test'); });
    expect(got).toBe(true);
    expect(result.current.entitled).toBe(true);
    expect(mockAnalytics.trackEntitlementSyncFailed).toHaveBeenCalledWith({ reason: 'purchase' });
  });

  it('boot still takes a server "false" at face value', async () => {
    mockStore[ENTITLEMENT_CACHE_KEY] = 'true';
    mockRc.identifyPurchasesUser.mockResolvedValue(proInfo);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: 'expired', expiresAt: null });
    const { result } = render();
    await waitFor(() => expect(result.current.entitled).toBe(false));
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('false');
  });

  it('lets the user in on the device verdict when the sync stalls past the cap, then applies the late answer', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    mockRc.restorePurchases.mockResolvedValue(proInfo);
    const pending = deferred<{ active: boolean; synced: boolean }>();
    mockApi.syncSubscription.mockReturnValue(pending.promise);
    let got: boolean | undefined;
    await act(async () => {
      const p = result.current.restore();
      await new Promise((r) => setImmediate(r));
      jest.advanceTimersByTime(4000);
      got = await p;
    });
    expect(got).toBe(true);
    expect(result.current.entitled).toBe(true);
    await act(async () => { pending.resolve({ active: true, synced: true }); });
    await waitFor(() => expect(mockApi.syncSubscription).toHaveBeenCalledTimes(1));
    expect(result.current.entitled).toBe(true);
    expect(mockAnalytics.trackPurchasesRestored).toHaveBeenCalledWith({ is_pro: true });
    jest.useRealTimers();
  });

  it('does not ask the server when the store says no', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockRc.purchasePackage.mockResolvedValue({ outcome: 'cancelled', customerInfo: null });
    let got: boolean | undefined;
    await act(async () => { got = await result.current.purchase({} as never, 'test'); });
    expect(got).toBe(false);
    expect(mockApi.syncSubscription).not.toHaveBeenCalled();
  });
});

describe('auth events', () => {
  it('SIGNED_IN identifies with RevenueCat and syncs unconditionally, even when the device says free', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.ready).toBe(true));
    mockApi.syncSubscription.mockResolvedValue({ active: true, synced: true });
    await act(async () => { mockAuthListener?.('SIGNED_IN', { user: { id: 'u2' } }); });
    await waitFor(() => expect(result.current.entitled).toBe(true));
    expect(mockRc.identifyPurchasesUser).toHaveBeenLastCalledWith('u2');
    expect(mockApi.syncSubscription).toHaveBeenCalledTimes(1);
  });

  it('SIGNED_OUT logs out of RevenueCat, drops the verdict, and clears the cache', async () => {
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: true, status: 'active', expiresAt: null });
    const { result } = render();
    await waitFor(() => expect(result.current.entitled).toBe(true));
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBe('true');
    await act(async () => { mockAuthListener?.('SIGNED_OUT', null); });
    await waitFor(() => expect(result.current.entitled).toBe(false));
    expect(mockRc.logoutPurchasesUser).toHaveBeenCalledTimes(1);
    expect(mockStore[ENTITLEMENT_CACHE_KEY]).toBeUndefined();
  });
});
