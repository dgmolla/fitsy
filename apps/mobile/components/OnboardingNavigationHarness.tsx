jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Alert, Button, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as ExpoLocation from 'expo-location';
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Index from '../app/index';
import MacroSetup from '../app/macro-setup';
import SignIn from '../app/welcome/signin';
import TrialReminder from '../app/welcome/trial-reminder';
import * as ExpoNotifications from 'expo-notifications';
import { readReminderPreferences } from '../lib/notificationSchedule';
import * as NotificationHelpers from '../lib/useNotifications';
import Notifications from '../app/welcome/notification-permission';
import Location from '../app/welcome/location-permission';
import WelcomeLayout from '../app/welcome/_layout';
import { PurchasesProvider } from '../lib/usePurchases';
import * as PurchasesHooks from '../lib/usePurchases';
import { getPaywallIntent, rememberPaywallIntent } from '../lib/paywallIntent';
import { recordOnboardingComplete } from '../lib/onboardingCompletion';
import { resetWelcomeJourney } from '../lib/paywallJourney';
import { getStoredToken } from '../lib/authClient';
import { saveMacroTargets } from '../lib/macroStorage';
import { saveOnboardingField } from '../lib/onboardingStorage';
import { hasPaymentSignInContinuation, rememberPaymentSignInContinuation } from '../lib/paymentSignInContinuation';
import { hasPendingMealClaim, rememberPendingMealClaim } from '../lib/pendingMealClaim';

type Session = { access_token: string; user: { id: string } } | null;
export const mockState: { session: Session } = { session: null };
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture() {}, identify() {} }));
});
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockState.session } }),
    signOut: async () => { mockState.session = null; return { error: null }; },
    setSession: async () => { mockState.session = { access_token: 'test-token', user: { id: 'buyer' } }; return { data: { session: mockState.session } }; },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    startAutoRefresh() {}, stopAutoRefresh() {},
  } }) };
});
jest.mock('expo-secure-store', () => {
  const values: Record<string, string> = Object.create(null);
  return { getItemAsync: async (key: string) => values[key] ?? null,
    setItemAsync: async (key: string, value: string) => { values[key] = value; },
    deleteItemAsync: async (key: string) => { delete values[key]; } };
});
jest.mock('expo-apple-authentication', () => ({ AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: async () => ({ identityToken: 'apple-token', authorizationCode: 'apple-code' }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'nonce', digestStringAsync: async () => 'hashed', CryptoDigestAlgorithm: { SHA256: 'SHA256' } }));
jest.mock('expo-auth-session/providers/google', () => {
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'test-google-client';
  const React = require('react');
  return { useIdTokenAuthRequest: () => {
    const [result, setResult] = React.useState(null);
    return [null, result, async () => { const next = { type: 'success', params: { id_token: 'google-token' } }; setResult(next); return next; }];
  } };
});
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession() {} }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
}));
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { revenueCat: { ios: 'test-store-key' } } } } }));

const originalFetch = global.fetch;
export const selected = { action: 'menu' as const, restaurantId: 'varilla', restaurantName: 'Varilla', menuItemId: 'meal-1', query: 'pizza' };
const defaultGetItem = (AsyncStorage.getItem as jest.Mock).getMockImplementation() as typeof AsyncStorage.getItem;
export function response(body: unknown) { return { ok: true, status: 200, json: async () => body } as Response; }
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function Preview() { return <><Text>Discovery preview</Text><Button title="Open selected menu" onPress={() => router.push('/welcome/signin')} /></>; }
function Restaurant() { const params = useLocalSearchParams(); return <Text>{JSON.stringify(params)}</Text>; }
function CompletePurchase() {
  const navigation = useNavigation();
  return <Button title="Complete purchased onboarding" onPress={() => { void recordOnboardingComplete(false).then(() => resetWelcomeJourney(navigation, 'notification-permission')); }} />;
}
export const routes = {
  _layout: () => <PurchasesProvider><Stack screenOptions={{ headerShown: false }} /></PurchasesProvider>,
  index: Index, 'welcome/_layout': WelcomeLayout,
  'welcome/signin': SignIn, 'welcome/notification-permission': Notifications,
  'welcome/trial-reminder': TrialReminder,
  'welcome/location-permission': Location, 'welcome/preview': Preview,
  'welcome/goal': () => <Text>Goal screen</Text>,
  'welcome/trial': () => <Text>Trial introduction</Text>,
  'welcome/payment': () => <Text>Payment plans</Text>,
  'welcome/resubscribe': () => <Text>Resubscribe plans</Text>,
  'welcome/subscription-check': () => <Text>Checking subscription</Text>,
  'welcome/problem': () => <Button title="Choose location" onPress={() => router.push('/welcome/location-permission')} />,
  'welcome/tried': () => <Text>Healthy eating approaches</Text>,
  'welcome/out-of-area': () => <Text>Area waitlist</Text>,
  'welcome/complete': CompletePurchase,
  '(tabs)/_layout': () => <Stack />, '(tabs)/search': () => <Text>Meal search</Text>,
  'restaurant/[id]': Restaurant,
  'macro-setup': () => <Text>Set meal targets</Text>,
};
beforeEach(async () => {
  jest.useRealTimers();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(defaultGetItem);
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync('fitsy_authToken');
  mockState.session = null;
  (ExpoNotifications.getPermissionsAsync as jest.Mock).mockReset().mockResolvedValue({ status: 'undetermined' });
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockClear();
  (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockClear();
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, status: 'active', expiresAt: null }));
});

export function installEligibleTrialOffer() {
  const annual = { identifier: '$rc_annual', product: { identifier: 'annual', priceString: '$59.99', subscriptionPeriod: 'P1Y',
    introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
  const offering = { identifier: 'default', annual, monthly: null, availablePackages: [annual], metadata: {} };
  jest.spyOn(PurchasesHooks, 'usePurchases').mockReturnValue({ ready: true, entitled: false, offering,
    introEligibility: { annual: true }, introEligibilityReady: true, refreshOffering: jest.fn(),
  } as never);
}
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

export function renderJourney(initialUrl: string, routeMap = routes) {
  const now = Date.now();
  const screen = renderRouter(routeMap, { initialUrl });
  // renderRouter resets fake time on each mount. A restart must not put a
  // persisted selection in the future after an earlier wait advanced time.
  jest.setSystemTime(now);
  return screen;
}


export { Alert, AsyncStorage, SecureStore, ExpoLocation, ExpoNotifications, NotificationHelpers, router, act, fireEvent, waitFor, MacroSetup, readReminderPreferences, getPaywallIntent, rememberPaywallIntent, getStoredToken, saveMacroTargets, saveOnboardingField, hasPaymentSignInContinuation, rememberPaymentSignInContinuation, hasPendingMealClaim, rememberPendingMealClaim, PurchasesHooks };
