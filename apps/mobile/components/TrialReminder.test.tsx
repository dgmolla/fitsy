jest.unmock('react-native');
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture() {}, identify() {} }));
});
jest.unmock('expo-router');
import React from 'react';
import { Button, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import TrialReminder from '../app/welcome/trial-reminder';
import { readReminderPreferences, saveReminderPreferences } from '../lib/notificationSchedule';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'trial-buyer' } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), startAutoRefresh() {}, stopAutoRefresh() {} } }) };
});
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { revenueCat: { ios: 'test-store-key' } } } } }));
jest.mock('expo-notifications', () => ({ requestPermissionsAsync: jest.fn(), scheduleNotificationAsync: jest.fn() }));
let mockEligibility: Record<string, boolean> = { annual: true };
jest.mock('../lib/usePurchases', () => ({ usePurchases: () => ({
  offering: { annual: { product: { identifier: 'annual', priceString: '$59.99', subscriptionPeriod: 'P1Y',
    introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } }, monthly: null },
  ready: true, introEligibilityReady: true, introEligibility: mockEligibility, refreshOffering: jest.fn(), entitled: false,
}) }));
const routes = { _layout: () => <Stack screenOptions={{ headerShown: false }} />, 'welcome/trial': () => <Button title="Continue to reminder" onPress={() => router.push('/welcome/trial-reminder')} />,
  'welcome/trial-reminder': TrialReminder, 'welcome/payment': () => <Text>Choose a plan</Text> };
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
beforeEach(async () => {
  mockEligibility = { annual: true };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ active: false }) });
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
});

test.each([['ineligible', { annual: false }], ['unknown', {}]])('%s saved reminder checkpoint goes to plans without requesting permission', async (_label, eligibility) => {
  mockEligibility = eligibility;
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.queryByTestId('trial-reminder-allow')).toBeNull();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('opt-in requests permission and saves the trial preference without enabling meal reminders or scheduling prematurely', async () => {
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: false, trial: true });
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('existing meal reminders stay enabled when opting in to trial reminders', async () => {
  await saveReminderPreferences('trial-buyer', { meals: true, trial: false });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: true, trial: true });
});

test.each(['denied', 'error', 'skip'])('%s continues to plans without saving a false opt-in', async outcome => {
  if (outcome === 'error') (Notifications.requestPermissionsAsync as jest.Mock).mockRejectedValue(new Error('Permission unavailable'));
  else (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await act(async () => { fireEvent.press(screen.getByTestId(outcome === 'skip' ? 'trial-reminder-skip' : 'trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: false, trial: false });
  if (outcome === 'skip') expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});


test('a late permission response cannot navigate after the reminder screen loses focus', async () => {
  let resolve!: (result: { status: string }) => void;
  (Notifications.requestPermissionsAsync as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await act(async () => { fireEvent.press(screen.getByText('Continue to reminder')); });
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await act(async () => { router.back(); });
  expect(screen.getPathname()).toBe('/welcome/trial');
  await act(async () => { resolve({ status: 'granted' }); });
  expect(screen.getPathname()).toBe('/welcome/trial');
});
