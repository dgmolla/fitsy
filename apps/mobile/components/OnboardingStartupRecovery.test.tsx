jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Alert, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Index from '../app/index';
import Profile from '../app/(tabs)/profile';
import { DiscoveryScreen } from './DiscoveryScreen';
import { saveOnboardingField } from '../lib/onboardingStorage';
import { PurchasesProvider } from '../lib/usePurchases';
import { getDiscoveryMacroTargetSnapshot, getMacroTargets } from '../lib/macroStorage';
import { replayPendingProfileSync } from '../lib/profileSync';
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
    '(tabs)/profile': Profile,
    'restaurant/[id]': Restaurant,
    'welcome/_layout': () => <Stack />,
    'welcome/problem': () => <Text>Welcome</Text>,
    'welcome/preview': () => <DiscoveryScreen onboardingPreview />,
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

it('recovers from Profile, saves a further edit and reopens with synchronized calories', async () => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify({ calories: '600', protein: '50', carbs: '65', fat: '20' }));
  const alert = jest.spyOn(Alert, 'alert');
  const screen = renderJourney('/profile');
  await waitFor(() => expect(screen.getByTestId('profile-restore-older-target')).toBeTruthy());
  expect(screen.getByText('Recover older targets')).toBeTruthy();
  fireEvent.press(screen.getByTestId('profile-restore-older-target'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Recover older targets', expect.any(String), expect.any(Array), { cancelable: false }));
  await act(async () => { alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Complete meal targets')!.onPress!(); });
  await waitFor(() => expect(screen.getByTestId('profile-edit-meal-targets')).toBeTruthy());
  fireEvent.press(screen.getByTestId('profile-edit-meal-targets'));
  expect(screen.getByLabelText('Protein grams').props.value).toBe('50');
  expect(screen.getByLabelText('Calories per meal').props.value).toBe('640');
  fireEvent.changeText(screen.getByLabelText('Protein grams'), '55');
  fireEvent(screen.getByLabelText('Protein grams'), 'blur');
  expect(screen.getByLabelText('Calories per meal').props.value).toBe('660');
  fireEvent.press(screen.getByTestId('meal-filter-apply'));
  await waitFor(async () => expect(await getMacroTargets()).toEqual({ protein: '55', carbs: '65', fat: '20', calories: '660' }));
  await act(async () => { await replayPendingProfileSync(); });
  expect((global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(init.body))).toContainEqual({
    macroTarget: { proteinG: 193, carbsG: 228, fatG: 70, source: 'manual', calories: 2314 },
  });
  screen.unmount();
  const reopened = renderJourney('/profile');
  await waitFor(() => expect(reopened.getByTestId('profile-edit-meal-targets')).toBeTruthy());
  expect(reopened.queryByTestId('profile-restore-older-target')).toBeNull();
  fireEvent.press(reopened.getByTestId('profile-edit-meal-targets'));
  expect(reopened.getByLabelText('Protein grams').props.value).toBe('55');
  expect(reopened.getByLabelText('Calories per meal').props.value).toBe('660');
});

it('cancels Profile recovery and later restores an independent filter without replacing profile targets', async () => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  const current = { calories: '740', protein: '60', carbs: '80', fat: '20' };
  const legacy = { calories: '600', protein: '50', carbs: '65', fat: '20' };
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify({ ...current, _mode: 'complete', _owner: 'buyer' }));
  await AsyncStorage.setItem('@fitsy/legacy_unowned_macro_targets', JSON.stringify(legacy));
  const alert = jest.spyOn(Alert, 'alert');
  const screen = renderJourney('/profile');
  await waitFor(() => expect(screen.getByTestId('profile-restore-older-target')).toBeTruthy());
  fireEvent.press(screen.getByTestId('profile-restore-older-target'));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  await act(async () => { alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Cancel')!.onPress!(); });
  expect(await getMacroTargets()).toEqual(current);
  expect(screen.getByTestId('profile-restore-older-target')).toBeTruthy();
  alert.mockClear();
  fireEvent.press(screen.getByTestId('profile-restore-older-target'));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  await act(async () => { alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Independent search filters')!.onPress!(); });
  await waitFor(() => expect(screen.queryByTestId('profile-restore-older-target')).toBeNull());
  expect(await getMacroTargets()).toEqual(current);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: legacy, mode: 'search' });
  expect((global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
});

it.each([
  { choice: 'Complete meal targets', calories: '640' },
  { choice: 'Independent search filters', calories: '600' },
])('recovers anonymous discovery through the visible $choice choice before searching', async ({ choice, calories }) => {
  await saveOnboardingField('area', { lat: 34.0522, lng: -118.2437, name: 'DTLA', source: 'manual' });
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify({ calories: '600', protein: '50', carbs: '65', fat: '20' }));
  global.fetch = jest.fn().mockResolvedValue(response({ data: [], meta: { nearbyDishCount: 10, radiusMiles: 3 } }));
  const alert = jest.spyOn(Alert, 'alert');
  const screen = renderJourney('/welcome/preview');
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Recover older targets', expect.any(String), expect.any(Array), { cancelable: false }));
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/api/restaurants'))).toHaveLength(0);
  await act(async () => { alert.mock.calls.at(-1)![2]!.find(button => button.text === choice)!.onPress!(); });
  await waitFor(() => {
    const requests = (global.fetch as jest.Mock).mock.calls
      .filter(([url]) => String(url).includes('/api/restaurants/preview?'))
      .map(([url]) => Object.fromEntries(new URL(String(url)).searchParams));
    expect(requests).toContainEqual(expect.objectContaining({ calories, protein: '50', carbs: '65', fat: '20' }));
  });
  await waitFor(() => expect(screen.getByTestId('preview-edit-targets')).toBeTruthy());
  fireEvent.press(screen.getByTestId('preview-edit-targets'));
  await waitFor(() => expect(screen.getByLabelText('Calories per meal').props.value).toBe(calories));
  expect(screen.getByLabelText('Protein grams').props.value).toBe('50');
  expect(screen.getByLabelText('Carbs grams').props.value).toBe('65');
  expect(screen.getByLabelText('Fat grams').props.value).toBe('20');
});
afterEach(() => { global.fetch = originalFetch; mockSession = null; jest.restoreAllMocks(); });

it.each([
  { choice: 'Complete meal targets', mode: 'complete', calories: '640' },
  { choice: 'Independent search filters', mode: 'search', calories: '600' },
])('recovers $mode intent at completed-account startup before target setup', async ({ choice, mode, calories }) => {
  mockSession = { access_token: 'test-token', user: { id: 'buyer' } };
  await AsyncStorage.setItem('onboardingComplete', 'true');
  const legacy = { calories: '600', protein: '50', carbs: '65', fat: '20' };
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify(legacy));
  const alert = jest.spyOn(Alert, 'alert');
  const screen = renderJourney('/');
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Recover older targets',
    expect.any(String), expect.any(Array), { cancelable: false }));
  expect(alert.mock.calls.at(-1)![1]).toContain('640 kcal');
  expect(alert.mock.calls.at(-1)![1]).toContain('keep 600 kcal');
  expect(screen.getPathname()).toBe('/');
  await act(async () => { alert.mock.calls.at(-1)![2]!.find(button => button.text === choice)!.onPress!(); });
  await waitFor(() => expect(screen.getPathname()).toBe('/search'));
  const targets = { ...legacy, calories };
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets, mode });
  expect(await getMacroTargets()).toEqual(mode === 'complete' ? targets : null);
  await replayPendingProfileSync();
  const patches = (global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'PATCH');
  if (mode === 'complete') expect(patches.map(([, init]) => JSON.parse(init.body))).toContainEqual({
    macroTarget: { proteinG: 175, carbsG: 228, fatG: 70, source: 'manual', calories: 2242 },
  });
  else expect(patches).toHaveLength(0);
  screen.unmount();
  alert.mockClear();
  const reopened = renderJourney('/');
  await waitFor(() => expect(reopened.getPathname()).toBe('/search'));
  expect(alert).not.toHaveBeenCalled();
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets, mode });
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
