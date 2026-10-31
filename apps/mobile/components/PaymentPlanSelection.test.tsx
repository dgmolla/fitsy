jest.unmock('react-native');
jest.unmock('expo-router');
import React, { useEffect } from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import * as Notifications from 'expo-notifications';
import { Stack, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import PaymentScreen from '../app/welcome/payment';
import TrialScreen from '../app/welcome/trial';
import TrialReminderScreen from '../app/welcome/trial-reminder';
import WelcomeLayout from '../app/welcome/_layout';
import { PurchasesProvider } from '../lib/usePurchases';
import { getPaywallIntent, rememberPaywallIntent } from '../lib/paywallIntent';
import { ONBOARDING_COMPLETE_KEY } from '../lib/onboardingCompletion';
import { readReminderPreferences } from '../lib/notificationSchedule';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
const mockCapture = jest.fn();
let mockAuthSession: { access_token: string; user: { id: string } } | null = null;
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture: (...args: unknown[]) => mockCapture(...args), identify() {} }));
});
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockAuthSession } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    startAutoRefresh() {}, stopAutoRefresh() {},
  } }) };
});
jest.mock('react-native-purchases', () => ({ __esModule: true, ...jest.requireActual('../__mocks__/react-native-purchases'),
  default: { ...jest.requireActual('../__mocks__/react-native-purchases').default, purchasePackage: jest.fn() } }));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { revenueCat: { ios: 'test-store-key' } } } } }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), scheduleNotificationAsync: jest.fn() }));
// SDK fixtures represent returned native results, not receipts or a bypass of
// the app's purchase and entitlement logic. Every application module is real.
const noSubscription = { entitlements: { active: {}, all: {} } } as CustomerInfo;
const pro = { identifier: 'pro', isActive: true, periodType: 'TRIAL', willRenew: true, expirationDate: '2030-01-08T12:00:00Z' };
const subscribed = { entitlements: { active: { pro }, all: { pro } } } as unknown as CustomerInfo;
const annual = { identifier: '$rc_annual', product: { identifier: 'annual', price: 59.99, priceString: '$59.99', currencyCode: 'USD', subscriptionPeriod: 'P1Y', introPrice: null } };
const monthly = { identifier: '$rc_monthly', product: { identifier: 'monthly', price: 9.99, priceString: '$9.99', currencyCode: 'USD', subscriptionPeriod: 'P1M',
  introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
const annualWithTrial = { ...annual, product: { ...annual.product, introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
const offering = { identifier: 'default', annual, monthly: null, availablePackages: [annual], metadata: {} } as unknown as PurchasesOffering;
const selected = { action: 'menu' as const, restaurantId: 'varilla', restaurantName: 'Varilla', menuItemId: 'meal-1', query: 'pizza' };
let restaurantMounts = 0;
let notificationMounts = 0;
let nativeListener: ((info: CustomerInfo) => void) | undefined;
let nativeUserId: string | null = null;
function Restaurant() {
  const params = useLocalSearchParams();
  useEffect(() => { restaurantMounts++; }, []);
  return <Text>{JSON.stringify(params)}</Text>;
}
function OldNotificationScreen() { useEffect(() => { notificationMounts++; }, []); return <Text>Old notification step</Text>; }
const routes = {
  _layout: () => <PurchasesProvider><Stack screenOptions={{ headerShown: false }} /></PurchasesProvider>,
  'welcome/_layout': WelcomeLayout, 'welcome/trial': TrialScreen, 'welcome/trial-reminder': TrialReminderScreen,
  'welcome/payment': PaymentScreen,
  'welcome/signin': () => <Text>Sign in before plans</Text>,
  'welcome/preview': () => <Text>Browse the preview</Text>,
  'welcome/resubscribe': () => <Text>Resubscribe plans</Text>,
  'welcome/notification-permission': OldNotificationScreen,
  '(tabs)/_layout': () => <Stack />, '(tabs)/search': () => <Text>Meal search</Text>, 'restaurant/[id]': Restaurant,
};
const originalFetch = global.fetch;
beforeEach(async () => {
  jest.useRealTimers();
  mockAuthSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await AsyncStorage.clear();
  restaurantMounts = 0;
  notificationMounts = 0;
  nativeListener = undefined;
  nativeUserId = null;
  mockCapture.mockClear();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
  (Notifications.requestPermissionsAsync as jest.Mock).mockReset().mockImplementation(async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    return { status: 'granted' };
  });
  (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
  (Purchases.purchasePackage as jest.Mock).mockReset().mockResolvedValue({ customerInfo: subscribed });
  jest.spyOn(Purchases, 'getCustomerInfo').mockResolvedValue(noSubscription);
  jest.spyOn(Purchases, 'logIn').mockImplementation(async userId => {
    nativeUserId = userId;
    return { customerInfo: noSubscription, created: false };
  });
  jest.spyOn(Purchases, 'getAppUserID').mockImplementation(async () => nativeUserId ?? '$RCAnonymousID:fixture');
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: offering, all: { default: offering } });
  jest.spyOn(Purchases, 'restorePurchases').mockResolvedValue(subscribed);
  jest.spyOn(Purchases, 'addCustomerInfoUpdateListener').mockImplementation(listener => { nativeListener = listener; });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    active: false, synced: true, verdict: 'never_subscribed', lastRcVerifiedAt: new Date().toISOString(), stale: false,
  }) });
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
test('anonymous direct payment entry shows sign-in without rendering plans first', async () => {
  mockAuthSession = null;
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  expect(screen.getByText('Sign in before plans')).toBeTruthy();
  expect(screen.queryByTestId('paywall-price-yearly')).toBeNull();
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();
});
test.each([
  { eligibility: { annual: 2, monthly: 1 }, expected: 'yearly', trial: true },
  { eligibility: { annual: 2, monthly: 2 }, expected: 'yearly', trial: true },
  { eligibility: { annual: 1, monthly: 1 }, expected: 'yearly', trial: false },
  { eligibility: { annual: 0, monthly: 0 }, expected: 'yearly', trial: false },
])('direct payment entry selects $expected for eligibility $eligibility', async ({ eligibility, expected, trial }) => {
  const both = { ...offering, annual: annualWithTrial, monthly, availablePackages: [annualWithTrial, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: eligibility.annual, description: 'Current annual eligibility' },
    monthly: { status: eligibility.monthly, description: 'Current monthly eligibility' },
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(Purchases.checkTrialOrIntroductoryPriceEligibility).toHaveBeenCalledWith(['annual', 'monthly']));
  await waitFor(() => expect(screen.getByTestId(`paywall-plan-${expected}`).props.accessibilityState.checked).toBe(true));
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityLabel.includes('free trial')).toBe(trial));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(annualWithTrial);
});
test('Back from a directly opened no-trial payment offers the existing exit flow', async () => {
  const screen = await openPayment();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await waitFor(() => expect(screen.getByTestId('paywall-back-to-plans')).toBeTruthy());
  expect(screen.getPathname()).toBe('/welcome/payment');
});
test('Back follows the selected paid plan when another plan has a trial', async () => {
  const both = { ...offering, annual, monthly, availablePackages: [annual, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 1, description: 'Ineligible' },
    monthly: { status: 2, description: 'Eligible' },
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true));
  await waitFor(() => expect(screen.getByTestId('paywall-plan-yearly').props.accessibilityState.disabled).toBe(false));
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-plan-yearly')); });
  await waitFor(() => expect(screen.getByTestId('paywall-terms').props.children.includes('free')).toBe(false));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  expect(screen.getByTestId('paywall-back-to-plans')).toBeTruthy();
  expect(screen.getPathname()).toBe('/welcome/payment');
});
test('Back from a directly opened trial paywall keeps the selected monthly plan', async () => {
  const both = { ...offering, annual: annualWithTrial, monthly, availablePackages: [annualWithTrial, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 2, description: 'Eligible' }, monthly: { status: 2, description: 'Eligible' },
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-plan-yearly').props.accessibilityState.checked).toBe(true));
  await waitFor(() => expect(screen.getByTestId('paywall-price-monthly').props.children).toBe('$9.99'));
  await waitFor(() => expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.disabled).toBe(false));
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-plan-monthly')); });
  await waitFor(() => expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await waitFor(() => expect(screen.getByTestId('paywall-back-to-plans')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-back-to-plans')); });
  expect(screen.getPathname()).toBe('/welcome/payment');
  expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true);
});

test('an explicit paid plan choice overrides the monthly trial and remains the purchase target', async () => {
  const both = { ...offering, annual, monthly, availablePackages: [annual, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' },
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true));
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState.disabled).toBe(false));
  await waitFor(() => expect(mockCapture).toHaveBeenCalledWith('trial_catalog_mismatch',
    expect.objectContaining({ product_id: 'monthly', actual_days: 7, desired_days: 14 })));
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-plan-yearly')); });
  expect(screen.getByTestId('paywall-plan-yearly').props.accessibilityState.checked).toBe(true);
  expect(mockCapture.mock.calls.filter(([event]) => event === 'trial_catalog_mismatch')).toHaveLength(1);
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).not.toContain('free trial');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(annual);
});

test('a matching two-week selected offer does not report a catalog mismatch', async () => {
  const twoWeekMonthly = { ...monthly, product: { ...monthly.product,
    introPrice: { price: 0, priceString: '$0', period: 'P2W', cycles: 1 } } };
  const both = { ...offering, annual, monthly: twoWeekMonthly, availablePackages: [annual, twoWeekMonthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' },
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-terms').props.children).toContain('14 days free'));
  expect(mockCapture.mock.calls.filter(([event]) => event === 'trial_catalog_mismatch')).toHaveLength(0);
});

test('an eligible calendar-month offer reports its actual period without assuming a fixed day count', async () => {
  const monthMonthly = { ...monthly, product: { ...monthly.product,
    introPrice: { price: 0, priceString: '$0', period: 'P1M', cycles: 1 } } };
  const both = { ...offering, annual, monthly: monthMonthly, availablePackages: [annual, monthMonthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' },
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-terms').props.children).toContain('1 month free'));
  await waitFor(() => expect(mockCapture).toHaveBeenCalledWith('trial_catalog_mismatch', expect.objectContaining({
    product_id: 'monthly', actual_days: null, actual_period: '1 month', desired_days: 14,
  })));
});

test('a short annual offer defaults to the schedulable monthly trial and plan switches keep the purchase target', async () => {
  const shortAnnual = { ...annual, product: { ...annual.product,
    introPrice: { price: 0, priceString: '$0', period: 'P2D', cycles: 1 } } };
  const twoWeekMonthly = { ...monthly, product: { ...monthly.product,
    introPrice: { price: 0, priceString: '$0', period: 'P2W', cycles: 1 } } };
  const both = { ...offering, annual: shortAnnual, monthly: twoWeekMonthly,
    availablePackages: [shortAnnual, twoWeekMonthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 2, description: 'Eligible' }, monthly: { status: 2, description: 'Eligible' },
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  jest.setSystemTime(new Date(2026, 8, 7, 12));
  await waitFor(() => expect(screen.getByTestId('paywall-terms').props.children).toContain('14 days free'));
  expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true);
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-plan-yearly')); });
  expect(screen.getByTestId('paywall-terms').props.children).toContain('2 days free');
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-plan-monthly')); });
  expect(screen.getByTestId('paywall-terms').props.children).toContain('14 days free');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(twoWeekMonthly);
});

const mixedTrials = [
  { shortPlan: 'yearly', longPlan: 'monthly', annualPeriod: 'P2D', monthlyPeriod: 'P1W' },
  { shortPlan: 'monthly', longPlan: 'yearly', annualPeriod: 'P1W', monthlyPeriod: 'P2D' },
] as const;
function offerMixedTrials(annualPeriod: string, monthlyPeriod: string) {
  const mixedAnnual = { ...annualWithTrial, product: { ...annualWithTrial.product,
    introPrice: { ...annualWithTrial.product.introPrice, period: annualPeriod } } };
  const mixedMonthly = { ...monthly, product: { ...monthly.product,
    introPrice: { ...monthly.product.introPrice, period: monthlyPeriod } } };
  const both = { ...offering, annual: mixedAnnual, monthly: mixedMonthly,
    availablePackages: [mixedAnnual, mixedMonthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 2, description: 'Eligible' }, monthly: { status: 2, description: 'Eligible' },
  });
  return { yearly: mixedAnnual, monthly: mixedMonthly };
}

test.each(mixedTrials)('mixed trials purchase the schedulable $longPlan default without a manual plan choice', async ({ longPlan, annualPeriod, monthlyPeriod }) => {
  const packages = offerMixedTrials(annualPeriod, monthlyPeriod);
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  jest.setSystemTime(new Date(2026, 8, 7, 12));
  await waitFor(() => expect(screen.getByTestId(`paywall-plan-${longPlan}`).props.accessibilityState.checked).toBe(true));
  await waitFor(() => expect(screen.getByTestId('paywall-terms').props.children).toContain('7 days free'));
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState.disabled).toBe(false));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(packages[longPlan]);
});

test.each(mixedTrials.flatMap(offer => [true, false].map(optIn => ({ ...offer, optIn }))))(
  'onboarding promises the $longPlan trial and switching to short $shortPlan removes reminder copy (opt-in: $optIn)',
  async ({ shortPlan, longPlan, annualPeriod, monthlyPeriod, optIn }) => {
    const packages = offerMixedTrials(annualPeriod, monthlyPeriod);
    const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
    jest.setSystemTime(new Date(2026, 8, 7, 12));
    await screen.findByText('Try Fitsy');
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    await screen.findByText('Get a trial reminder');
    expect(screen.getByText(new RegExp(`If you choose the ${longPlan === 'yearly' ? 'Annual' : 'Monthly'} plan`))).toBeTruthy();
    expect(screen.getByText(/free trial of 7 days ends/)).toBeTruthy();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId(optIn ? 'trial-reminder-allow' : 'trial-reminder-skip')); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
    await waitFor(() => expect(screen.getByTestId(`paywall-plan-${longPlan}`).props.accessibilityState.checked).toBe(true));
    await waitFor(() => expect(screen.getByTestId(`paywall-plan-${shortPlan}`).props.accessibilityState.disabled).toBe(false));
    const longCopy = optIn ? /We'll send you a reminder/ : /turn on reminders after purchase/;
    await screen.findByText(longCopy);
    expect((await readReminderPreferences('buyer')).trial).toBe(optIn);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(optIn ? 1 : 0);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    await act(async () => { fireEvent.press(screen.getByTestId(`paywall-plan-${shortPlan}`)); });
    expect(screen.getByText('Reminder unavailable')).toBeTruthy();
    expect(screen.queryByText(/We'll send you a reminder|turn on reminders after purchase/)).toBeNull();
    expect(screen.getByText(/too short for a reminder/)).toBeTruthy();
    expect(screen.getByTestId('paywall-terms').props.children).toContain(`2 days free, then ${packages[shortPlan].product.priceString}`);
    expect(screen.getByTestId('paywall-terms').props.children).toContain('Renews automatically');

    await act(async () => { fireEvent.press(screen.getByTestId(`paywall-plan-${longPlan}`)); });
    expect(screen.getByText(longCopy)).toBeTruthy();
    expect(screen.getByTestId('paywall-terms').props.children).toContain('7 days free');
    await act(async () => { fireEvent.press(screen.getByTestId(`paywall-plan-${shortPlan}`)); });
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    expect(Purchases.purchasePackage).toHaveBeenCalledWith(packages[shortPlan]);
  },
);

test('eligibility changes on the paywall update its selection and purchase target', async () => {
  const both = { ...offering, annual: annualWithTrial, monthly, availablePackages: [annualWithTrial, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  const eligibility = jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValueOnce({
    annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' },
  }).mockResolvedValue({ annual: { status: 2, description: 'Eligible' }, monthly: { status: 1, description: 'Ineligible' } });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true));
  const updatedInfo = { ...noSubscription } as CustomerInfo;
  (Purchases.getCustomerInfo as jest.Mock).mockResolvedValue(updatedInfo);
  await act(async () => { nativeListener?.(updatedInfo); });
  await waitFor(() => expect(eligibility).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('paywall-plan-yearly').props.accessibilityState.checked).toBe(true));
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toContain('free trial');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(annualWithTrial);
});

test('a CustomerInfo refresh cannot switch a monthly trial to a paid annual purchase while eligibility is pending', async () => {
  const both = { ...offering, annual, monthly, availablePackages: [annual, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  let settleEligibility: ((value: Record<string, { status: number; description: string }>) => void) | undefined;
  const eligibility = jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValueOnce({
    annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' },
  }).mockImplementationOnce(() => new Promise(resolve => { settleEligibility = resolve; }));
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true));
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toContain('free trial'));

  const updatedInfo = { ...noSubscription } as CustomerInfo;
  (Purchases.getCustomerInfo as jest.Mock).mockResolvedValue(updatedInfo);
  await act(async () => { nativeListener?.(updatedInfo); });
  await waitFor(() => expect(eligibility).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true);
  expect(screen.getByTestId('welcome-continue').props.accessibilityState.disabled).toBe(true);
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).not.toHaveBeenCalled();

  await act(async () => { settleEligibility?.({ annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' } }); });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState.disabled).toBe(false));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(monthly);
});

test.each(['purchase', 'restore'])('%s opens the selected meal directly and a later SDK update cannot redirect twice', async action => {
  const screen = await openPayment();
  await act(async () => { fireEvent.press(screen.getByTestId(action === 'purchase' ? 'welcome-continue' : 'paywall-restore')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBe('true');
  expect(await getPaywallIntent()).toBeNull();
  expect(notificationMounts).toBe(0);
  expect(restaurantMounts).toBe(1);
  if (action === 'purchase') expect(Purchases.purchasePackage).toHaveBeenCalledWith(annual);
  else { expect(Purchases.restorePurchases).toHaveBeenCalledTimes(1); expect(Purchases.purchasePackage).not.toHaveBeenCalled(); }
  (Purchases.getCustomerInfo as jest.Mock).mockResolvedValue(subscribed);
  await act(async () => { nativeListener?.(subscribed); });
  expect(screen.getPathname()).toBe('/restaurant/varilla');
  expect(restaurantMounts).toBe(1);
  expect(mockCapture.mock.calls.filter(([event]) => event === 'onboarding_completed')).toHaveLength(1);
});
