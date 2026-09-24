jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Alert, Button, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Index from '../app/index';
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
import { getPaywallIntent, getPurchasedContinuation, rememberPaywallIntent } from '../lib/paywallIntent';
import { recordOnboardingComplete } from '../lib/onboardingCompletion';
import { resetWelcomeJourney } from '../lib/paywallJourney';
import { saveMacroTargets } from '../lib/macroStorage';
import { getStoredToken } from '../lib/authClient';

type Session = { access_token: string; user: { id: string } } | null;
let mockSession: Session = null;
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
    getSession: async () => ({ data: { session: mockSession } }),
    signOut: async () => { mockSession = null; return { error: null }; },
    setSession: async () => { mockSession = { access_token: 'test-token', user: { id: 'buyer' } }; return { data: { session: mockSession } }; },
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
jest.mock('expo-notifications', () => ({ requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }) }));
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { revenueCat: { ios: 'test-store-key' } } } } }));

const originalFetch = global.fetch;
const selected = { action: 'menu' as const, restaurantId: 'varilla', restaurantName: 'Varilla', menuItemId: 'meal-1', query: 'pizza' };
const targets = { calories: '650', protein: '42', carbs: '68', fat: '23' };
function response(body: unknown) { return { ok: true, status: 200, json: async () => body } as Response; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function Preview() { return <><Text>Discovery preview</Text><Button title="Open selected menu" onPress={() => router.push('/welcome/signin')} /></>; }
function Restaurant() { const params = useLocalSearchParams(); return <Text>{JSON.stringify(params)}</Text>; }
function CompletePurchase() {
  const navigation = useNavigation();
  return <Button title="Complete purchased onboarding" onPress={() => { void recordOnboardingComplete(false).then(() => resetWelcomeJourney(navigation, 'notification-permission')); }} />;
}
const routes = {
  _layout: () => <PurchasesProvider><Stack screenOptions={{ headerShown: false }} /></PurchasesProvider>,
  index: Index, 'welcome/_layout': WelcomeLayout,
  'welcome/signin': SignIn, 'welcome/notification-permission': Notifications,
  'welcome/trial-reminder': TrialReminder,
  'welcome/location-permission': Location, 'welcome/preview': Preview,
  'welcome/trial': () => <Text>Trial introduction</Text>,
  'welcome/payment': () => <Text>Payment plans</Text>,
  'welcome/problem': () => <Button title="Choose location" onPress={() => router.push('/welcome/location-permission')} />,
  'welcome/tried': () => <Text>Healthy eating approaches</Text>,
  'welcome/out-of-area': () => <Text>Area waitlist</Text>,
  'welcome/complete': CompletePurchase,
  '(tabs)/_layout': () => <Stack />, '(tabs)/search': () => <Text>Meal search</Text>,
  'restaurant/[id]': Restaurant,
};
beforeEach(async () => {
  jest.useRealTimers();
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync('fitsy_authToken');
  mockSession = null;
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockClear();
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, status: 'active', expiresAt: null }));
});

it('asks an anonymous trial reminder opt-in to sign in before permission, then returns to the choice', async () => {
  installEligibleTrialOffer();
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  const screen = renderJourney('/welcome/trial-reminder');
  await act(async () => { fireEvent.press(await screen.findByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  expect(ExpoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(await readReminderPreferences('buyer')).toEqual({ meals: false, trial: false });
  (global.fetch as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.endsWith('/api/auth/login')
    ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: true })
    : response({ active: false })));
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await act(async () => { fireEvent.press(screen.getByTestId('signup-dev')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial-reminder'));
  expect(ExpoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(await screen.findByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(ExpoNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await readReminderPreferences('buyer')).toEqual({ meals: false, trial: true });
});

it('registers a push token after a signed-in trial reminder opt-in', async () => {
  installEligibleTrialOffer();
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  jest.spyOn(NotificationHelpers, 'getExpoPushTokenAsync').mockResolvedValue('ExponentPushToken[buyer]');
  const screen = renderJourney('/welcome/trial-reminder');
  await act(async () => { fireEvent.press(await screen.findByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(await readReminderPreferences('buyer')).toEqual({ meals: false, trial: true });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/user/push-token'),
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'ExponentPushToken[buyer]' }) }),
  ));
});

it('does not register account A trial token after account B signs in during token retrieval', async () => {
  installEligibleTrialOffer();
  mockSession = { access_token: 'token-a', user: { id: 'buyer-a' } };
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  const token = deferred<string>();
  jest.spyOn(NotificationHelpers, 'getExpoPushTokenAsync').mockReturnValueOnce(token.promise);
  const screen = renderJourney('/welcome/trial-reminder');
  await act(async () => { fireEvent.press(await screen.findByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  await waitFor(() => expect(NotificationHelpers.getExpoPushTokenAsync).toHaveBeenCalled());
  mockSession = { access_token: 'token-b', user: { id: 'buyer-b' } };
  await act(async () => { token.resolve('ExponentPushToken[buyer-a]'); });
  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining('/api/user/push-token'), expect.anything(),
  );
});

it('does not sign out account B for account A push registration returning 401 late', async () => {
  installEligibleTrialOffer();
  mockSession = { access_token: 'token-a', user: { id: 'buyer-a' } };
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
  jest.spyOn(NotificationHelpers, 'getExpoPushTokenAsync').mockResolvedValueOnce('ExponentPushToken[buyer-a]');
  const pushResponse = deferred<Response>();
  global.fetch = jest.fn((url: RequestInfo | URL) => String(url).endsWith('/api/user/push-token')
    ? pushResponse.promise : Promise.resolve(response({ active: false })));
  const screen = renderJourney('/welcome/trial-reminder');
  await act(async () => { fireEvent.press(await screen.findByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/user/push-token'), expect.objectContaining({ method: 'POST' }),
  ));
  mockSession = { access_token: 'token-b', user: { id: 'buyer-b' } };
  await act(async () => { pushResponse.resolve({ ok: false, status: 401 } as Response); });
  expect(mockSession?.user.id).toBe('buyer-b');
  expect(screen.getPathname()).toBe('/welcome/payment');
});

function installEligibleTrialOffer() {
  const annual = { identifier: '$rc_annual', product: { identifier: 'annual', priceString: '$59.99', subscriptionPeriod: 'P1Y',
    introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
  const offering = { identifier: 'default', annual, monthly: null, availablePackages: [annual], metadata: {} };
  jest.spyOn(PurchasesHooks, 'usePurchases').mockReturnValue({ ready: true, entitled: false, offering,
    introEligibility: { annual: true }, introEligibilityReady: true, refreshOffering: jest.fn(),
  } as never);
}
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

function renderJourney(initialUrl: string) {
  const now = Date.now();
  const screen = renderRouter(routes, { initialUrl });
  // renderRouter resets fake time on each mount. A restart must not put a
  // persisted selection in the future after an earlier wait advanced time.
  jest.setSystemTime(now);
  return screen;
}

it('shows only explicit notification choices after purchase resets earlier history', async () => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/welcome/complete');
  await act(async () => { fireEvent.press(screen.getByText('Complete purchased onboarding')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/notification-permission'));
  expect(screen.getByTestId('notification-skip')).toBeTruthy();
  expect(screen.queryByTestId('welcome-back')).toBeNull();
});

it('keeps Not now as the explicit route to the purchased restaurant and selected dish', async () => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/welcome/notification-permission');
  await act(async () => { fireEvent.press(screen.getByTestId('notification-skip')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await getPaywallIntent()).toBeNull();
});

it('does not advertise Back when a cold sign-in checkpoint has no earlier route', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'signin');
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/signin'));
  expect(await screen.findByText('Varilla')).toBeTruthy();
  expect(screen.queryByTestId('welcome-back')).toBeNull();
  expect(await getPaywallIntent()).toEqual(selected);
});

it.each([
  ['apple', '/api/auth/apple', true, true], ['apple', '/api/auth/apple', false, true],
  ['google', '/api/auth/google', true, true], ['google', '/api/auth/google', false, true],
  ['dev', '/api/auth/login', true, true], ['dev', '/api/auth/login', false, true],
  ['apple', '/api/auth/apple', true, false], ['google', '/api/auth/google', true, false], ['dev', '/api/auth/login', true, false],
] as const)('continues %s (%s) only when still on sign-in: success=%s, Back=%s', async (provider, path, success, back) => {
  const exchange = deferred<Response>();
  const alert = jest.spyOn(Alert, 'alert');
  (global.fetch as jest.Mock).mockImplementation((url: string) => url.endsWith(path) || url.endsWith('/api/auth/register') ? exchange.promise : Promise.resolve(response({ active: false })));
  await rememberPaywallIntent(selected);
  const screen = renderJourney('/welcome/preview');
  await act(async () => { fireEvent.press(screen.getByText('Open selected menu')); });
  await act(async () => { fireEvent.press(screen.getByTestId(`signup-${provider}`)); });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(path), expect.anything()));
  if (back) await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  expect(screen.getPathname()).toBe(back ? '/welcome/preview' : '/welcome/signin');
  await act(async () => { exchange.resolve(success ? response({ token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: true }) : { ...response({ error: 'Offline' }), ok: false }); });
  expect(screen.getPathname()).toBe(back ? '/welcome/preview' : '/welcome/trial');
  expect(await getPaywallIntent()).toEqual(back ? null : selected);
  expect(await getStoredToken()).toBe(success ? 'test-token' : null);
  expect(alert).not.toHaveBeenCalled();
});

it.each(['covered', 'empty', 'failure'])('ignores a %s area response after Back', async (outcome) => {
  const coverage = deferred<Response>();
  const alert = jest.spyOn(Alert, 'alert');
  (global.fetch as jest.Mock).mockReturnValue(coverage.promise);
  const screen = renderJourney('/welcome/problem');
  await act(async () => { fireEvent.press(screen.getByText('Choose location')); });
  await act(async () => { fireEvent.press(screen.getByTestId('location-choose-area')); });
  await act(async () => { fireEvent.press(screen.getByText({ covered: 'Silver Lake', empty: 'Hollywood', failure: 'Echo Park' }[outcome]!)); });
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  expect(screen.getPathname()).toBe('/welcome/problem');
  await act(async () => { coverage.resolve(outcome === 'failure' ? { ...response({ error: 'Offline' }), ok: false } : response({ data: [], meta: { nearbyDishCount: outcome === 'covered' ? 1 : 0, radiusMiles: 3 } })); });
  expect(screen.getPathname()).toBe('/welcome/problem');
  expect(alert).not.toHaveBeenCalled();
});

it('resumes a purchased restaurant after terminating on optional notifications', async () => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await saveMacroTargets(targets);
  await rememberPaywallIntent(selected);
  const first = renderJourney('/welcome/complete');
  await act(async () => { fireEvent.press(first.getByText('Complete purchased onboarding')); });
  await waitFor(() => expect(first.getPathname()).toBe('/welcome/notification-permission'));
  expect(await getPurchasedContinuation()).toEqual(selected);
  first.unmount();
  const resumed = renderJourney('/');
  await waitFor(() => expect(resumed.getPathname()).toBe('/restaurant/varilla'));
  expect(resumed.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await getPaywallIntent()).toBeNull();
});

it.each(['another account', 'unentitled buyer'] as const)('does not resume a purchased selection for %s', async (state) => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await saveMacroTargets(targets);
  await rememberPaywallIntent(selected);
  await recordOnboardingComplete(false);
  if (state === 'another account') mockSession = { access_token: 'other-token', user: { id: 'other' } };
  else (global.fetch as jest.Mock).mockResolvedValue(response({ active: false, status: null, expiresAt: null }));
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).not.toBe('/'));
  expect(screen.getPathname()).not.toBe('/restaurant/varilla');
  if (state === 'another account') expect(await getPaywallIntent()).toBeNull();
});
