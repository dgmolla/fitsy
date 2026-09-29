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
import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

export const mockForeground: { listener?: (state: string) => void } = {};
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  // Preserve native getters without eagerly spreading them (which loads
  // DevMenu outside an iOS binary in Jest).
  const mocked = Object.create(actual);
  Object.defineProperty(mocked, 'AppState', { enumerable: true, value: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mockForeground.listener = listener;
      return { remove: () => { if (mockForeground.listener === listener) mockForeground.listener = undefined; } };
    },
  } });
  return mocked;
});

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
  ensurePurchasesUser: jest.fn(async () => true),
  fetchCustomerInfo: jest.fn(async () => freeInfo),
  currentPurchasesUserId: jest.fn(async () => mockAuth.session?.user.id ?? null),
  fetchCurrentOffering: jest.fn(async () => null),
  // Exercise the real new seam; do not add another mock of our own code.
  fetchIntroEligibility: (ids: string[]) =>
    jest.requireActual<typeof import('./purchases')>('./purchases').fetchIntroEligibility(ids),
  addCustomerInfoListener: jest.fn((_cb: (info: Info) => void) => () => undefined),
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
  trackOnboardingScreenView: jest.fn(),
  trackEntitlementMismatch: jest.fn(),
  trackEntitlementSyncFailed: jest.fn(),
  trackPaywallShown: jest.fn(),
  trackPaywallResult: jest.fn(),
  trackPurchasesRestored: jest.fn(),
};
jest.mock('./analytics', () => mockLazy(() => mockAnalytics));

export const mockStore: Record<string, string> = {};
export function seedEntitlementCache(verdict: 'active' | 'expired' | 'never_subscribed', userId = 'u1'): void {
  mockStore['@fitsy/entitlement'] = JSON.stringify({
    userId, active: verdict === 'active', verdict, expiresAt: null,
    lastRcVerifiedAt: new Date().toISOString(),
  });
}
export function cachedEntitlementVerdict(): string | null {
  const raw = mockStore['@fitsy/entitlement'];
  return raw ? (JSON.parse(raw) as { verdict: string }).verdict : null;
}
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
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    for (const k of Object.keys(mockStore)) delete mockStore[k];
    mockAuth.session = { user: { id: 'u1' } };
    mockAuth.listener = undefined;
    mockForeground.listener = undefined;
    mockRc.identifyPurchasesUser.mockResolvedValue(freeInfo);
    mockRc.ensurePurchasesUser.mockResolvedValue(true);
    mockRc.fetchCustomerInfo.mockResolvedValue(freeInfo);
    mockRc.currentPurchasesUserId.mockImplementation(async () => mockAuth.session?.user.id ?? null);
    mockApi.fetchSubscriptionStatus.mockResolvedValue({ active: false, status: null, expiresAt: null, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString() });
    mockApi.syncSubscription.mockResolvedValue({ active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString() });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
}
