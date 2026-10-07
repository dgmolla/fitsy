jest.unmock('react-native');
jest.unmock('expo-router');
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { getPaywallIntent, rememberPaywallIntent } from '../lib/paywallIntent';
import { ONBOARDING_COMPLETE_KEY } from '../lib/onboardingCompletion';
import { BOOT_VERDICT_CAP_MS } from '../lib/usePurchases';
import { saveReminderPreferences } from '../lib/notificationSchedule';
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
let notificationMounts = 0;
let nativeUserId: string | null = null;
const routes = paymentCompletionRoutes(() => { notificationMounts++; });
const originalFetch = global.fetch;
beforeEach(async () => {
  jest.useRealTimers();
  jest.mocked(Notifications.getPermissionsAsync).mockReset().mockResolvedValue({ status: 'undetermined' } as Notifications.NotificationPermissionsStatus);
  mockAuthSession = { access_token: 'test-token', user: { id: 'buyer' } };
  mockSessionRead = null;
  mockAuthListeners.clear(); await AsyncStorage.clear();
  notificationMounts = 0; nativeUserId = null; mockCapture.mockClear();
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

test('an anonymous paywall view is attributed once across plan changes', async () => {
  mockAuthSession = null;
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-price-yearly')).toBeTruthy());
  await waitFor(() => expect(mockCapture).toHaveBeenCalledWith('paywall_experiment_exposed', expect.objectContaining({ paywall_variant: 'B', layout_variant: 'trial_timeline' })));
  expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes('/restaurants/preview'))).toBe(false);
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-plan-monthly')); });
  expect(mockCapture.mock.calls.filter(([name]) => name === 'paywall_experiment_exposed')).toHaveLength(1);
});

test('a stalled initial session read reveals the paywall and accepts a late identity', async () => {
  jest.useFakeTimers();
  let resolveSession!: (value: { data: { session: typeof mockAuthSession } }) => void;
  const pending = new Promise<{ data: { session: typeof mockAuthSession } }>(resolve => { resolveSession = resolve; });
  try {
    mockSessionRead = () => pending;
    const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
    expect(screen.queryByTestId('paywall-logo')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS + 100); });
    expect(screen.getByTestId('paywall-logo')).toBeTruthy();
    await act(async () => resolveSession({ data: { session: mockAuthSession } }));
    expect(mockCapture.mock.calls.filter(([name]) => name === 'paywall_experiment_exposed')).toHaveLength(2);
    expect(screen.getByTestId('welcome-continue')).toBeTruthy();
  } finally {
    resolveSession({ data: { session: mockAuthSession } });
    jest.useRealTimers();
  }
});

test('a stale granted permission read cannot restore a reminder promise after foreground denial', async () => {
  const trialAnnual = { ...annual, product: { ...annual.product, introPrice: monthly.product.introPrice } };
  const trialOffering = { ...offering, annual: trialAnnual, availablePackages: [trialAnnual] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: trialOffering, all: { default: trialOffering } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({ annual: { status: 2, description: 'Eligible' } });
  await saveReminderPreferences('buyer', { meals: false, trial: true });
  let resolveFirst!: (value: Notifications.NotificationPermissionsStatus) => void;
  const permission = jest.mocked(Notifications.getPermissionsAsync)
    .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockResolvedValue({ status: 'denied' } as Notifications.NotificationPermissionsStatus);
  const listeners: Array<(state: string) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove: jest.fn() } as never;
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-offer-timeline')).toBeTruthy());
  await waitFor(() => expect(permission).toHaveBeenCalled());
  await act(async () => { listeners.forEach(listener => listener('active')); });
  await waitFor(() => expect(screen.getByText('Notifications off. Enable them in settings.')).toBeTruthy());
  await act(async () => resolveFirst({ status: 'granted' } as Notifications.NotificationPermissionsStatus));
  expect(screen.queryByText("We'll send you a reminder that your trial is ending soon")).toBeNull();
});

test('signing in while payment is focused records the authenticated exposure once', async () => {
  mockAuthSession = null;
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(mockCapture.mock.calls.filter(([name]) => name === 'paywall_experiment_exposed')).toHaveLength(1));
  mockAuthSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { for (const listener of mockAuthListeners) listener('SIGNED_IN', mockAuthSession); });
  await waitFor(() => expect(mockCapture.mock.calls.filter(([name]) => name === 'paywall_experiment_exposed')).toHaveLength(2));
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-plan-monthly')); });
  expect(mockCapture.mock.calls.filter(([name]) => name === 'paywall_experiment_exposed')).toHaveLength(2);
});

test('development visual trial uses live price but never enters checkout or restore', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment?devTrialVisual=1' });
  await waitFor(() => expect(screen.getByTestId('dev-trial-visual-note')).toBeTruthy());
  expect(screen.getByTestId('paywall-price-yearly').props.children).toBe('$59.99');
  expect(screen.getByTestId('paywall-logo')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-restore')); });
  expect(alert).toHaveBeenCalledWith('Visual preview only', expect.any(String));
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  expect(Purchases.restorePurchases).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
});

test('development visual flag stays on the three real welcome screens', async () => {
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial?devTrialVisual=1' });
  await waitFor(() => expect(screen.getByText('Try Fitsy')).toBeTruthy());
  expect(screen.getByTestId('trial-no-payment')).toBeTruthy();
  expect(screen.getByTestId('trial-visual-note').props.children).toContain('Synthetic trial eligibility');
  expect(screen.queryByTestId('trial-offer-note')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial-reminder'));
  expect(screen.getByTestId('trial-reminder-note').props.children).toContain('Synthetic trial eligibility');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.getByTestId('dev-trial-visual-note')).toBeTruthy();
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();
});

test.each(['cancelled', 'no active entitlement'])('%s stays on the real paywall without recording completion', async outcome => {
  if (outcome === 'cancelled') (Purchases.purchasePackage as jest.Mock).mockRejectedValue({ userCancelled: true });
  else (Purchases.purchasePackage as jest.Mock).mockResolvedValue({ customerInfo: noSubscription });
  const screen = await openPayment();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledTimes(1);
  expect(screen.getPathname()).toBe('/welcome/payment');
  expect(await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
  expect(await getPaywallIntent()).toEqual(selected);
  expect(notificationMounts).toBe(0);
});

test('a signed-in buyer whose RevenueCat identity fails cannot enter native checkout', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const alert = jest.spyOn(Alert, 'alert');
  (Purchases.logIn as jest.Mock).mockRejectedValue(new Error('identity offline'));
  const screen = await openPayment();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Purchase not available', 'We could not confirm your account with the store. Please try again.');
  expect(screen.getPathname()).toBe('/welcome/payment');
  expect(await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
});

test('an already identified buyer reaches native checkout', async () => {
  const screen = await openPayment();
  await waitFor(() => expect(nativeUserId).toBe('buyer'));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.getAppUserID).toHaveBeenCalled();
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(annual);
});
