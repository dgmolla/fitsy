jest.unmock('react-native');
jest.unmock('expo-router');
import React, { useEffect } from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases, { type CustomerInfo, type PurchasesOffering } from 'react-native-purchases';
import { Stack, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import PaymentScreen from '../app/welcome/payment';
import TrialScreen from '../app/welcome/trial';
import TrialReminderScreen from '../app/welcome/trial-reminder';
import WelcomeLayout from '../app/welcome/_layout';
import { PurchasesProvider } from '../lib/usePurchases';
import { getPaywallIntent, rememberPaywallIntent } from '../lib/paywallIntent';
import { ONBOARDING_COMPLETE_KEY } from '../lib/onboardingCompletion';

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
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ active: false, synced: true }) });
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

test('an explicit paid plan choice overrides the monthly trial and remains the purchase target', async () => {
  const both = { ...offering, annual, monthly, availablePackages: [annual, monthly] } as unknown as PurchasesOffering;
  jest.spyOn(Purchases, 'getOfferings').mockResolvedValue({ current: both, all: { default: both } });
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 1, description: 'Ineligible' }, monthly: { status: 2, description: 'Eligible' },
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/payment' });
  await waitFor(() => expect(screen.getByTestId('paywall-plan-monthly').props.accessibilityState.checked).toBe(true));
  await act(async () => { fireEvent.press(screen.getByTestId('paywall-plan-yearly')); });
  expect(screen.getByTestId('paywall-plan-yearly').props.accessibilityState.checked).toBe(true);
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).not.toContain('free trial');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(Purchases.purchasePackage).toHaveBeenCalledWith(annual);
});

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
