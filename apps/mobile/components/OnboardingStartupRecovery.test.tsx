jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Alert, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Index from '../app/index';
import { PurchasesProvider } from '../lib/usePurchases';
import { getDiscoveryMacroTargetSnapshot, getMacroTargets } from '../lib/macroStorage';
import { getPurchasedContinuation, markPurchasedContinuation, rememberPaywallIntent } from '../lib/paywallIntent';
import { installAccountProfile } from './test-fixtures/accountProfile';
type Session = { access_token: string; user: { id: string } } | null;
let mockSession: Session = null;
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockSession } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    startAutoRefresh() {}, stopAutoRefresh() {},
  } }) };
});
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { revenueCat: { ios: 'test-store-key' } } } } }));
const originalFetch = global.fetch;
const emptyProfile = { user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: null }, macroTarget: null };
const selected = { action: 'menu' as const, restaurantId: 'varilla', restaurantName: 'Varilla', menuItemId: 'meal-1', query: 'pizza' };
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function Restaurant() { const params = useLocalSearchParams(); return <Text>{JSON.stringify(params)}</Text>; }
function renderJourney(initialUrl: string) {
  const now = Date.now();
  const screen = renderRouter({
    _layout: () => <PurchasesProvider><Stack screenOptions={{ headerShown: false }} /></PurchasesProvider>,
    index: Index, '(tabs)/_layout': () => <Stack />, '(tabs)/search': () => <Text>Meal search</Text>,
    'restaurant/[id]': Restaurant,
    'welcome/_layout': () => <Stack />,
    'welcome/problem': () => <Text>Welcome</Text>,
  }, { initialUrl });
  jest.setSystemTime(now);
  return screen;
}
beforeEach(async () => {
  jest.useRealTimers();
  await AsyncStorage.clear();
  mockSession = null;
  global.fetch = jest.fn().mockImplementation((url: string) => Promise.resolve(response(
    String(url).includes('/api/user/profile') ? emptyProfile : { verdict: 'active', active: true, expiresAt: null },
  )));
});
afterEach(() => { global.fetch = originalFetch; mockSession = null; jest.restoreAllMocks(); });

it('offers legacy filter recovery at completed-account startup before target setup', async () => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await AsyncStorage.setItem('onboardingComplete', 'true');
  const legacy = { calories: '600', protein: '50', carbs: '65', fat: '20' };
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify(legacy));
  const alert = jest.spyOn(Alert, 'alert');
  const screen = renderJourney('/');
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Restore older search filter?',
    expect.any(String), expect.any(Array), { cancelable: false }));
  expect(screen.getPathname()).toBe('/');
  await act(async () => { alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Restore')!.onPress!(); });
  await waitFor(() => expect(screen.getPathname()).toBe('/search'));
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(legacy);
  expect(await getMacroTargets()).toBeNull();
});

it('hydrates a server target at startup while retaining the purchased selected-meal destination', async () => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await AsyncStorage.setItem('onboardingComplete', 'true');
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify({ calories: '600', protein: '50', carbs: '65', fat: '20' }));
  await rememberPaywallIntent(selected);
  await markPurchasedContinuation();
  expect(await getPurchasedContinuation()).toEqual(selected);
  installAccountProfile('buyer', { calories: 2590, proteinG: 210, carbsG: 280, fatG: 70, source: 'manual' });
  const alert = jest.spyOn(Alert, 'alert');
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getPathname()).toBe('/restaurant/varilla'));
  expect(screen.getByText(JSON.stringify({ id: 'varilla', selectedItemId: 'meal-1' }))).toBeTruthy();
  expect(await getMacroTargets()).toEqual({ calories: '740', protein: '60', carbs: '80', fat: '20' });
  expect(alert).not.toHaveBeenCalled();
});

it('holds replacement setup during a profile outage and retries the real startup recovery', async () => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await AsyncStorage.setItem('onboardingComplete', 'true');
  let offline = true;
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (String(url).includes('/api/user/profile')) {
      if (offline) return Promise.reject(new Error('offline'));
      return Promise.resolve(response({ ...emptyProfile, macroTarget: {
        calories: 2590, proteinG: 210, carbsG: 280, fatG: 70, source: 'manual',
      } }));
    }
    return Promise.resolve(response({ verdict: 'active', active: true, expiresAt: null }));
  });
  const screen = renderJourney('/');
  await waitFor(() => expect(screen.getByTestId('target-recovery-retry')).toBeTruthy());
  expect(screen.getPathname()).toBe('/');
  expect(await getMacroTargets()).toBeNull();
  expect(screen.queryByText('Set your macro targets')).toBeNull();
  offline = false;
  fireEvent.press(screen.getByTestId('target-recovery-retry'));
  await waitFor(() => expect(screen.getPathname()).toBe('/search'));
  expect(await getMacroTargets()).toEqual({ calories: '740', protein: '60', carbs: '80', fat: '20' });
});
