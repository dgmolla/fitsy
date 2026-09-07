/**
 * Shared harness for the PurchasesProvider tests (usePurchases.*.test.tsx).
 *
 * The native seam (`./purchases`), the API transport (`./apiClient`), the
 * Supabase session, analytics, and AsyncStorage are mocked here; what runs
 * for real is the provider plus `./useEntitlementVerdict` and
 * `./entitlement`. Import this module FIRST in each test file: its
 * jest.mock calls must be registered before `./usePurchases` is required.
 */
import React, { useEffect } from 'react';
import { act, renderHook } from '@testing-library/react-native';

export type Info = { entitlements: { active: Record<string, unknown>; all: Record<string, unknown> } };
export const proInfo: Info = { entitlements: { active: { pro: {} }, all: { pro: {} } } };
export const freeInfo: Info = { entitlements: { active: {}, all: {} } };

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

export const mockRc = {
  configurePurchases: jest.fn(() => true),
  identifyPurchasesUser: jest.fn(async () => freeInfo),
  fetchCustomerInfo: jest.fn(async () => freeInfo),
  fetchCurrentOffering: jest.fn(async () => null),
  addCustomerInfoListener: jest.fn(() => () => undefined),
  logoutPurchasesUser: jest.fn(async () => undefined),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
  presentPaywall: jest.fn(),
  showManageSubscriptions: jest.fn(async () => undefined),
  isProActive: (info: Info | null) => !!info && info.entitlements.active['pro'] !== undefined,
  hasLapsedEntitlement: (info: Info | null) =>
    !!info && info.entitlements.active['pro'] === undefined && info.entitlements.all['pro'] !== undefined,
};
jest.mock('./purchases', () => mockLazy(() => mockRc));

export const mockApi = {
  syncSubscription: jest.fn(),
  fetchSubscriptionStatus: jest.fn(),
};
jest.mock('./apiClient', () => mockLazy(() => mockApi));

/** Mutable session the mocked Supabase client reports; `getSession` is countable. */
export const mockAuth: {
  session: { user: { id: string } } | null;
  listener: ((event: string, session: unknown) => void) | undefined;
  getSession: jest.Mock;
} = {
  session: { user: { id: 'u1' } },
  listener: undefined,
  getSession: jest.fn(async () => ({ data: { session: mockAuth.session } })),
};
jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => mockAuth.getSession(...a),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mockAuth.listener = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  },
}));

export const mockAnalytics = {
  trackEntitlementMismatch: jest.fn(),
  trackEntitlementSyncFailed: jest.fn(),
  trackPaywallShown: jest.fn(),
  trackPaywallResult: jest.fn(),
  trackPurchasesRestored: jest.fn(),
};
jest.mock('./analytics', () => mockLazy(() => mockAnalytics));

export const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStore[key] ?? null,
    setItem: async (key: string, value: string) => { mockStore[key] = value; },
    removeItem: async (key: string) => { delete mockStore[key]; },
  },
}));

// Required after the mocks above are registered (see the header comment).
import { PurchasesProvider, usePurchases } from './usePurchases';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PurchasesProvider>{children}</PurchasesProvider>
);
export const renderProvider = () => renderHook(() => usePurchases(), { wrapper });
export type ProviderResult = { current: ReturnType<typeof usePurchases> };

/**
 * Like renderProvider, but also records every distinct value `entitled`
 * took, in order, so a test can assert what a gate would have seen.
 */
export function renderProviderTracking() {
  const seen: (boolean | null)[] = [];
  const hook = renderHook(
    () => {
      const value = usePurchases();
      useEffect(() => {
        if (seen[seen.length - 1] !== value.entitled) seen.push(value.entitled);
      }, [value.entitled]);
      return value;
    },
    { wrapper },
  );
  return { ...hook, seen };
}

/** Drain the microtask/immediate queue so pending provider work settles. */
export const flush = () => act(async () => { await new Promise((r) => setImmediate(r)); });

/** Fake timers that leave the immediate/microtask queue real, so `flush` still drains. */
export const useFakeTimersKeepingFlush = () =>
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });

/** A promise the test resolves by hand, to hold the server mid-flight. */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Register the per-test reset every provider test file needs. */
export function setupPurchasesMocks(): void {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(mockStore)) delete mockStore[k];
    mockAuth.session = { user: { id: 'u1' } };
    mockAuth.listener = undefined;
    mockRc.identifyPurchasesUser.mockResolvedValue(freeInfo);
    mockRc.fetchCustomerInfo.mockResolvedValue(freeInfo);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: null, expiresAt: null });
    mockApi.syncSubscription.mockResolvedValue({ active: false, synced: true });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
}
