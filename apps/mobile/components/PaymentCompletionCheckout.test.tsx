jest.unmock('react-native');
jest.unmock('expo-router');
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { rememberPaywallIntent } from '../lib/paywallIntent';
import { ONBOARDING_COMPLETE_KEY } from '../lib/onboardingCompletion';
import { paymentCompletionRoutes } from './paymentCompletionRoutes';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('expo-notifications', () => ({ ...jest.requireActual('expo-notifications'), getPermissionsAsync: jest.fn() }));
const mockCapture = jest.fn();
let mockAuthSession: { access_token: string; user: { id: string } } | null = null;
let mockSessionRead: (() => Promise<{ data: { session: typeof mockAuthSession } }>) | null = null;
const mockAuthListeners = new Set<(event: string, session: typeof mockAuthSession) => void>();
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture: (...args: unknown[]) => mockCapture(...args), identify() {} }));
});
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
    getSession: async () => mockSessionRead ? mockSessionRead() : ({ data: { session: mockAuthSession } }),
    onAuthStateChange: (listener: (event: string, session: typeof mockAuthSession) => void) => {
      mockAuthListeners.add(listener);
      return { data: { subscription: { unsubscribe() { mockAuthListeners.delete(listener); } } } };
    },
    startAutoRefresh() {}, stopAutoRefresh() {},
  } }) };
});
jest.mock('react-native-purchases', () => ({ __esModule: true, ...jest.requireActual('../__mocks__/react-native-purchases'),
  default: { ...jest.requireActual('../__mocks__/react-native-purchases').default, purchasePackage: jest.fn() } }));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { revenueCat: { ios: 'test-store-key' } } } } }));

// SDK fixtures represent returned native results, not receipts or a bypass of
// the app's purchase and entitlement logic. Every application module is real.
const noSubscription = { entitlements: { active: {}, all: {} } } as CustomerInfo;
const pro = { identifier: 'pro', isActive: true, periodType: 'TRIAL', willRenew: true, expirationDate: '2030-01-08T12:00:00Z' };
const subscribed = { entitlements: { active: { pro }, all: { pro } } } as unknown as CustomerInfo;
const annual = { identifier: '$rc_annual', product: { identifier: 'annual', price: 59.99, priceString: '$59.99', currencyCode: 'USD', subscriptionPeriod: 'P1Y', introPrice: null } };
const monthly = { identifier: '$rc_monthly', product: { identifier: 'monthly', price: 9.99, priceString: '$9.99', currencyCode: 'USD', subscriptionPeriod: 'P1M', introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
const offering = { identifier: 'default', annual, monthly: null, availablePackages: [annual], metadata: {} } as unknown as PurchasesOffering;
const selected = { action: 'menu' as const, restaurantId: 'varilla', restaurantName: 'Varilla', menuItemId: 'meal-1', query: 'pizza' };
let nativeUserId: string | null = null;
const routes = paymentCompletionRoutes(() => {});
const originalFetch = global.fetch;
beforeEach(async () => {
  jest.useRealTimers();
  jest.mocked(Notifications.getPermissionsAsync).mockReset().mockResolvedValue({ status: 'undetermined' } as Notifications.NotificationPermissionsStatus);
  mockAuthSession = { access_token: 'test-token', user: { id: 'buyer' } };
  mockSessionRead = null;
  mockAuthListeners.clear(); await AsyncStorage.clear();
  nativeUserId = null; mockCapture.mockClear();
  (Purchases.purchasePackage as jest.Mock).mockReset().mockResolvedValue({ customerInfo: subscribed });
  jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(noSubscription);
  jest.spyOn(Purchases, 'logIn').mockImplementation(async userId => { nativeUserId = userId; return { customerInfo: noSubscription, created: false }; });
  jest.spyOn(Purchases, 'getAppUserID').mockImplementation(async () => nativeUserId ?? '$RCAnonymousID:fixture');
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: offering, all: { default: offering } });
  jest.spyOn(Purchases, 'restorePurchases').mockResolvedValue(subscribed); jest.spyOn(Purchases, 'addCustomerInfoUpdateListener').mockImplementation(() => {});
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString(), stale: false }) });
  await rememberPaywallIntent(selected);
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
async function openPayment() {
  const now = Date.now();
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  jest.setSystemTime(now);
  await waitFor(() => expect(screen.getByTestId('paywall-price-yearly').props.children).toBe('$59.99'));
  await act(async () => {});
  expect(mockCapture).toHaveBeenCalledWith('paywall_experiment_exposed', expect.objectContaining({ image_variant: 'none', layout_variant: 'trial_timeline' }));
  return screen;
}

test('a checkout identity timeout never starts a late purchase and a retry can succeed', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const screen = await openPayment();
  nativeUserId = null;
  let resolveIdentity!: (value: { customerInfo: CustomerInfo; created: boolean }) => void;
  (Purchases.logIn as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveIdentity = resolve; }));
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(resolveIdentity).toBeDefined());
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Payment service still connecting', 'Fully close and reopen Fitsy, then try again.');
  await act(async () => { nativeUserId = 'buyer'; resolveIdentity({ customerInfo: noSubscription, created: false }); });
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  alert.mockClear();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(annual);
  expect(alert).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test('a pending boot identity keeps repeated checkout attempts blocked until the native request settles', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  let resolveIdentity!: (value: { customerInfo: CustomerInfo; created: boolean }) => void;
  (Purchases.logIn as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveIdentity = resolve; }));
  const screen = await openPayment();
  await waitFor(() => expect(resolveIdentity).toBeDefined());
  expect(screen.getByTestId('welcome-continue').props.accessibilityState.disabled).toBe(true);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  }
  expect(alert).not.toHaveBeenCalled();
  expect(Purchases.logIn).toHaveBeenCalledTimes(1);
  await act(async () => { nativeUserId = 'buyer'; resolveIdentity({ customerInfo: noSubscription, created: false }); });
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState.disabled).toBe(false));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(annual);
});

test('a fresh provider mount verifies the current auth and native payment identities before checkout', async () => {
  (Purchases.purchasePackage as jest.Mock).mockResolvedValue({ customerInfo: noSubscription });
  const initial = await openPayment();
  await act(async () => { fireEvent.press(initial.getByTestId('welcome-continue')); });
  await waitFor(() => expect(nativeUserId).toBe('buyer'));
  initial.unmount();
  mockAuthSession = { access_token: 'new-token', user: { id: 'new-buyer' } };
  nativeUserId = 'former-buyer';
  const screen = await openPayment();
  await waitFor(() => expect(nativeUserId).toBe('new-buyer'));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.logIn).toHaveBeenCalledWith('new-buyer');
  expect(Purchases.getAppUserID).toHaveBeenCalled();
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(annual);
});

test.each(['account change', 'sign-out'])('%s during pending checkout identity prevents the old purchase', async change => {
  const screen = await openPayment();
  nativeUserId = null;
  let resolveIdentity!: (value: { customerInfo: CustomerInfo; created: boolean }) => void;
  (Purchases.logIn as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveIdentity = resolve; }));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(resolveIdentity).toBeDefined());
  mockAuthSession = change === 'sign-out' ? null : { access_token: 'second-token', user: { id: 'second-buyer' } };
  await act(async () => { for (const listener of mockAuthListeners) listener(change === 'sign-out' ? 'SIGNED_OUT' : 'SIGNED_IN', mockAuthSession); });
  await act(async () => { nativeUserId = 'buyer'; resolveIdentity({ customerInfo: noSubscription, created: false }); });
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
});

test('a late current-user Pro identity rechecks the server and opens search from the real paywall', async () => {
  const screen = await openPayment();
  let resolveIdentity!: (value: { customerInfo: CustomerInfo; created: boolean }) => void;
  (Purchases.logIn as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveIdentity = resolve; }));
  global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
    const reason = init?.body ? JSON.parse(String(init.body)).reason as string : undefined;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ active: reason === 'mismatch', synced: true, verdict: reason === 'mismatch' ? 'active' : 'never_subscribed', lastRcVerifiedAt: new Date().toISOString(), stale: false }) });
  });
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  mockAuthSession = { access_token: 'returning-token', user: { id: 'returning-pro' } };
  await act(async () => { for (const listener of mockAuthListeners) listener('SIGNED_IN', mockAuthSession); });
  await act(async () => { jest.advanceTimersByTime(1500); });
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([, init]) =>
    init?.body && JSON.parse(String(init.body)).reason === 'sign_in')).toBe(true));
  expect(screen.getPathname()).toBe('/welcome/payment');
  await act(async () => { resolveIdentity({ customerInfo: subscribed, created: false }); });
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([, init]) =>
    init?.body && JSON.parse(String(init.body)).reason === 'mismatch')).toBe(true));
  await waitFor(() => expect(screen.getPathname()).toBe('/search'));
  jest.useRealTimers();
});

test('unknown introductory eligibility leaves the store to confirm the first charge', async () => {
  const introAnnual = { ...annual, product: { ...annual.product, introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
  const introOffering = { ...offering, annual: introAnnual, availablePackages: [introAnnual] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: introOffering, all: { default: introOffering } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({ annual: { status: 0, description: 'Unknown' } });
  const screen = await openPayment();
  await waitFor(() => expect(Purchases.checkTrialOrIntroductoryPriceEligibility).toHaveBeenCalledWith(['annual']));
  await act(async () => {});
  await waitFor(() => expect(screen.getByTestId('paywall-terms').props.children).toContain('store will confirm any eligible introductory offer and the first charge'));
  expect(screen.getByTestId('paywall-terms').props.children).not.toContain('$59.99 when you confirm');
});

test('monthly-only trial routes through reminder to monthly checkout and purchases monthly', async () => {
  const both = { ...offering, annual, monthly, availablePackages: [annual, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({ annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' } });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await waitFor(() => expect(screen.getByText('Try Fitsy')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial-reminder'));
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-skip')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true);
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toContain('free trial');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(monthly);
});

test('a saved reminder link enters monthly trial checkout without a preceding trial screen', async () => {
  const both = { ...offering, annual, monthly, availablePackages: [annual, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({ annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' } });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByTestId('trial-reminder-skip')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-skip')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true);
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(monthly);
});

test('a direct payment link selects monthly when it is the only available package', async () => {
  const monthlyOnly = { ...offering, annual: null, monthly, availablePackages: [monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: monthlyOnly, all: { default: monthlyOnly } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({ monthly: { status: 0, description: 'Unknown' } });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true));
  await waitFor(() => expect(screen.getByTestId('paywall-terms').props.children).toContain('store will confirm'));
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState.disabled).toBe(false));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(monthly);
});
