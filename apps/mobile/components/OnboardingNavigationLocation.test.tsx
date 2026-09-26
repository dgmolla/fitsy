jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Animated, Button, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as ExpoLocation from 'expo-location';
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Index from '../app/index';
import SignIn from '../app/welcome/signin';
import TrialReminder from '../app/welcome/trial-reminder';
import * as ExpoNotifications from 'expo-notifications';
import Notifications from '../app/welcome/notification-permission';
import Location from '../app/welcome/location-permission';
import Problem from '../app/welcome/problem';
import WelcomeLayout from '../app/welcome/_layout';
import { PurchasesProvider } from '../lib/usePurchases';
import { getPaywallIntent, getPurchasedContinuation, rememberPaywallIntent } from '../lib/paywallIntent';
import { recordOnboardingComplete } from '../lib/onboardingCompletion';
import { resetWelcomeJourney } from '../lib/paywallJourney';
import { saveMacroTargets } from '../lib/macroStorage';
import { hasSeenPreviewTour, hasUsedPreviewSample, markPreviewSampleUsed, markPreviewTourSeen } from '../lib/teaserGate';
import { getOnboardingData } from '../lib/onboardingStorage';

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
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
}));
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { revenueCat: { ios: 'test-store-key' } } } } }));

const originalFetch = global.fetch;
const selected = { action: 'menu' as const, restaurantId: 'varilla', restaurantName: 'Varilla', menuItemId: 'meal-1', query: 'pizza' };
const targets = { calories: '650', protein: '42', carbs: '68', fat: '23' };
const defaultGetItem = (AsyncStorage.getItem as jest.Mock).getMockImplementation() as typeof AsyncStorage.getItem;
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
  'welcome/goal': () => <Text>Goal screen</Text>,
  'welcome/trial': () => <Text>Trial introduction</Text>,
  'welcome/start-real': Problem,
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
  (AsyncStorage.getItem as jest.Mock).mockImplementation(defaultGetItem);
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync('fitsy_authToken');
  mockSession = null;
  (ExpoNotifications.getPermissionsAsync as jest.Mock).mockReset().mockResolvedValue({ status: 'undetermined' });
  (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockClear();
  (ExpoLocation.requestForegroundPermissionsAsync as jest.Mock).mockClear();
  global.fetch = jest.fn().mockResolvedValue(response({ active: true, status: 'active', expiresAt: null }));
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

function renderJourney(initialUrl: string) {
  const now = Date.now();
  const screen = renderRouter(routes, { initialUrl });
  // renderRouter resets fake time on each mount. A restart must not put a
  // persisted selection in the future after an earlier wait advanced time.
  jest.setSystemTime(now);
  return screen;
}

it('resets a spent preview sample and tour when a new onboarding pass starts', async () => {
  markPreviewSampleUsed();
  markPreviewTourSeen();
  expect(await hasUsedPreviewSample()).toBe(true);
  expect(await hasSeenPreviewTour()).toBe(true);
  jest.spyOn(Animated, 'loop').mockReturnValue({ start: jest.fn(), stop: jest.fn() } as never);
  const screen = renderJourney('/welcome/start-real');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-start')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/location-permission'));
  expect(await hasUsedPreviewSample()).toBe(false);
  expect(await hasSeenPreviewTour()).toBe(false);
  await waitFor(async () => {
    expect(await AsyncStorage.getItem('@fitsy/previewSampleUsed')).toBeNull();
    expect(await AsyncStorage.getItem('@fitsy/previewTourSeen')).toBeNull();
  });
});
it('waits for a saved area before enabling location choices', async () => {
  const area = { lat: 34.05, lng: -118.25, name: 'Downtown', source: 'manual' as const };
  const stored = deferred<string | null>();
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(key => key === '@fitsy/onboarding' ? stored.promise : defaultGetItem(key));
  const permission = jest.spyOn(ExpoLocation, 'requestForegroundPermissionsAsync');
  const screen = renderJourney('/welcome/location-permission');
  fireEvent.press(screen.getByTestId('location-use-current'));
  expect(permission).not.toHaveBeenCalled();
  expect(screen.getPathname()).toBe('/welcome/location-permission');
  await act(async () => { stored.resolve(JSON.stringify({ area })); });
  await screen.findByTestId('location-continue-area');
  global.fetch = jest.fn().mockResolvedValue(response({ data: [], meta: { nearbyDishCount: 1, radiusMiles: 3 } }));
  await act(async () => { fireEvent.press(screen.getByTestId('location-continue-area')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/goal'));
  expect(permission).not.toHaveBeenCalled();
});

it('lets a saved-area user switch to device location', async () => {
  await AsyncStorage.setItem('@fitsy/onboarding', JSON.stringify({ area: { lat: 34.05, lng: -118.25, name: 'Downtown', source: 'manual' } }));
  const permission = jest.spyOn(ExpoLocation, 'requestForegroundPermissionsAsync')
    .mockResolvedValue({ status: ExpoLocation.PermissionStatus.GRANTED } as never);
  jest.spyOn(ExpoLocation, 'getCurrentPositionAsync')
    .mockResolvedValue({ coords: { latitude: 34.1, longitude: -118.2 } } as never);
  global.fetch = jest.fn().mockResolvedValue(response({ data: [], meta: { nearbyDishCount: 1, radiusMiles: 3 } }));
  const screen = renderJourney('/welcome/location-permission');
  await screen.findByTestId('location-continue-area');
  await act(async () => { fireEvent.press(screen.getByTestId('location-use-current')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/goal'));
  expect(permission).toHaveBeenCalledTimes(1);
  expect(ExpoLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  expect((await getOnboardingData()).area).toEqual({ lat: 34.1, lng: -118.2, name: 'Your location', source: 'gps' });
});

it('uses device permission only after confirming there is no saved area', async () => {
  const stored = deferred<string | null>();
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(key => key === '@fitsy/onboarding' ? stored.promise : defaultGetItem(key));
  const permission = jest.spyOn(ExpoLocation, 'requestForegroundPermissionsAsync').mockResolvedValue({ status: ExpoLocation.PermissionStatus.DENIED } as never);
  const screen = renderJourney('/welcome/location-permission');
  fireEvent.press(screen.getByTestId('location-use-current'));
  expect(permission).not.toHaveBeenCalled();
  await act(async () => { stored.resolve(null); });
  await act(async () => { fireEvent.press(screen.getByTestId('location-use-current')); });
  expect(permission).toHaveBeenCalledTimes(1);
});

it('offers a retry when the saved area read fails', async () => {
  let reads = 0;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(key => {
    if (key !== '@fitsy/onboarding') return defaultGetItem(key);
    reads += 1;
    return reads === 1 ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve(null);
  });
  const permission = jest.spyOn(ExpoLocation, 'requestForegroundPermissionsAsync').mockResolvedValue({ status: ExpoLocation.PermissionStatus.DENIED } as never);
  const screen = renderJourney('/welcome/location-permission');
  await screen.findByTestId('location-retry-area');
  expect(screen.getByText('Your saved area could not load. Please try again.')).toBeTruthy();
  expect(permission).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('location-retry-area')); });
  await screen.findByTestId('location-use-current');
  await act(async () => { fireEvent.press(screen.getByTestId('location-use-current')); });
  expect(permission).toHaveBeenCalledTimes(1);
});

it('keeps the newer saved area when an earlier read finishes after returning', async () => {
  const stale = deferred<string | null>();
  let reads = 0;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(key => {
    if (key !== '@fitsy/onboarding') return defaultGetItem(key);
    reads += 1;
    return reads === 1 ? stale.promise : Promise.resolve(JSON.stringify({ area: { lat: 34.05, lng: -118.25, name: 'New area', source: 'manual' } }));
  });
  const screen = renderJourney('/welcome/problem');
  await act(async () => { fireEvent.press(screen.getByText('Choose location')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await act(async () => { fireEvent.press(screen.getByText('Choose location')); });
  expect(await screen.findByText('Continue with New area')).toBeTruthy();
  await act(async () => { stale.resolve(JSON.stringify({ area: { lat: 40.71, lng: -74, name: 'Old area', source: 'manual' } })); });
  expect(screen.getByText('Continue with New area')).toBeTruthy();
  expect(screen.queryByText('Continue with Old area')).toBeNull();
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
