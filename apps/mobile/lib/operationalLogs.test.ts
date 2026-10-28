import { inspect } from 'node:util';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';
import {
  configurePurchases, ensurePurchasesUser, fetchCustomerInfo, fetchOfferings,
  identifyPurchasesUser, presentPaywall, presentPaywallIfNeeded, purchasePackage,
  restorePurchases, showManageSubscriptions,
} from './purchases';
import { fetchProfile, pushProfileToServer, replayPendingProfileSync, pullProfileFromServer } from './profileSync';
import { fetchServerEntitlement } from './entitlement';
import { fetchRestaurantsPage } from './apiClient';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://auth.example.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'fixture-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: {
    access_token: 'fixture-token', user: { id: 'fixture-user' },
  } } }) } }) };
});

const SENTINEL = 'PRIVATE_SENTINEL_575';
const sensitiveError = Object.assign(new Error(`${SENTINEL} provider body and token`), {
  userInfo: { accountId: SENTINEL, email: SENTINEL, receipt: SENTINEL },
});
const originalDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
let logs: jest.SpyInstance[];

beforeAll(() => {
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
});
afterAll(() => {
  if (originalDev) Object.defineProperty(globalThis, '__DEV__', originalDev);
  else Reflect.deleteProperty(globalThis, '__DEV__');
});
beforeEach(async () => {
  await AsyncStorage.clear();
  logs = ['error', 'warn', 'info', 'log'].map(level =>
    jest.spyOn(console, level as 'error').mockImplementation(() => {}));
  jest.spyOn(global, 'fetch').mockRejectedValue(sensitiveError);
});
afterEach(() => {
  const captured = inspect(logs.map(log => log.mock.calls), { depth: 10 });
  jest.restoreAllMocks();
  expect(captured).not.toContain(SENTINEL);
});

it('replaces SDK message forwarding before configuration, including native error/warning logs', () => {
  const handler = jest.spyOn(Purchases, 'setLogHandler');
  const configure = jest.spyOn(Purchases, 'configure');
  expect(configurePurchases()).toBe(true);
  expect(handler.mock.invocationCallOrder[0]).toBeLessThan(configure.mock.invocationCallOrder[0]);
  const report = handler.mock.calls[0][0];
  for (const level of [LOG_LEVEL.DEBUG, LOG_LEVEL.INFO, LOG_LEVEL.WARN, LOG_LEVEL.ERROR]) report(level, SENTINEL);
  expect(logs[1].mock.calls).toEqual([['[purchases] sdk_warning'], ['[purchases] sdk_error']]);
});

it.each([
  ['logIn', () => identifyPurchasesUser(SENTINEL)],
  ['getAppUserID', () => ensurePurchasesUser(SENTINEL)],
  ['getCustomerInfo', () => fetchCustomerInfo()],
  ['getOfferings', () => fetchOfferings()],
  ['restorePurchases', () => restorePurchases('fixture-user', async () => true)],
  ['purchasePackage', () => purchasePackage({} as PurchasesPackage, 'fixture-user', async () => true)],
  ['showManageSubscriptions', () => showManageSubscriptions(null)],
] as const)('keeps %s recovery behavior without logging SDK error data', async (method, operation) => {
  jest.spyOn(Purchases, 'getAppUserID').mockResolvedValue('fixture-user');
  jest.spyOn(Purchases, method).mockRejectedValue(sensitiveError);
  await operation();
  expect(logs[1]).toHaveBeenCalled();
});

it.each(['presentPaywall', 'presentPaywallIfNeeded'] as const)('contains %s SDK failures', async method => {
  jest.spyOn(RevenueCatUI, method).mockRejectedValue(sensitiveError);
  expect(await (method === 'presentPaywall' ? presentPaywall() : presentPaywallIfNeeded())).toBe('error');
  expect(logs[1]).toHaveBeenCalled();
});

it('keeps account sync and search failures private at the real HTTP transport boundary', async () => {
  expect(await fetchProfile()).toBeNull();
  expect(await pushProfileToServer('fixture-user', { name: SENTINEL })).toBe(false);
  expect(await fetchServerEntitlement('boot')).toEqual({ data: null, error: 'network' });
  expect(await fetchRestaurantsPage({ lat: 34, lng: -118 })).toMatchObject({ networkError: true });
  await AsyncStorage.setItem('@fitsy/pending_profile_sync:fixture-user', '{invalid');
  await replayPendingProfileSync();
  expect(await pullProfileFromServer()).toBe('unavailable');
  expect(logs[1]).toHaveBeenCalled();
});
