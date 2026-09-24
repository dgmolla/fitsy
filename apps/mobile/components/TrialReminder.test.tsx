jest.unmock('react-native');
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture() {}, identify() {} }));
});
jest.unmock('expo-router');
import React from 'react';
import { AppState, Button, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import TrialReminder from '../app/welcome/trial-reminder';
import { readReminderPreferences, saveReminderPreferences } from '../lib/notificationSchedule';
import * as useNotifications from '../lib/useNotifications';

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
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), scheduleNotificationAsync: jest.fn() }));
let mockEligibility: Record<string, boolean> = { annual: true };
const annual = { product: { identifier: 'annual', priceString: '$59.99', subscriptionPeriod: 'P1Y',
  introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
const shortAnnual = { product: { ...annual.product, introPrice: { ...annual.product.introPrice, period: 'P2D' } } };
const monthly = { product: { ...annual.product, identifier: 'monthly', subscriptionPeriod: 'P1M' } };
const shortMonthly = { product: { ...monthly.product, introPrice: { ...monthly.product.introPrice, period: 'P2D' } } };
let mockOffering: { annual: typeof annual; monthly: typeof annual | null } | null = { annual, monthly: null };
jest.mock('../lib/usePurchases', () => ({ usePurchases: () => ({
  offering: mockOffering,
  ready: true, introEligibilityReady: true, introEligibility: mockEligibility, refreshOffering: jest.fn(), entitled: false,
}) }));
const routes = { _layout: () => <Stack screenOptions={{ headerShown: false }} />, 'welcome/trial': () => <Button title="Continue to reminder" onPress={() => router.push('/welcome/trial-reminder')} />,
  'welcome/trial-reminder': TrialReminder, 'welcome/payment': () => <Text>Choose a plan</Text> };
const originalFetch = global.fetch;
let appStateListener: jest.SpyInstance;
afterEach(() => { global.fetch = originalFetch; appStateListener.mockRestore(); });
beforeEach(async () => {
  mockEligibility = { annual: true };
  mockOffering = { annual, monthly: null };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ active: false }) });
  await AsyncStorage.clear();
  jest.clearAllMocks();
  appStateListener = jest.spyOn(AppState, 'addEventListener').mockImplementation(() =>
    ({ remove() {} }) as ReturnType<typeof AppState.addEventListener>);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
});

test('a previously denied permission does not promise or request a trial reminder', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('Notifications are off.')).toBeTruthy());
  expect(Notifications.getPermissionsAsync).toHaveBeenCalled();
  expect(screen.queryByText('We can notify you before your trial ends.')).toBeNull();
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('refreshes the reminder choice when notifications are enabled in device settings', async () => {
  const listeners: Array<(state: string) => void> = [];
  appStateListener.mockImplementation((_event, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove() {} } as ReturnType<typeof AppState.addEventListener>;
  });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('Notifications are off.')).toBeTruthy());
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  await act(async () => { listeners.forEach(listener => listener('active')); });
  await waitFor(() => expect(screen.getByText('We can notify you before your trial ends.')).toBeTruthy());
  expect(screen.getByText('Remind me')).toBeTruthy();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  await act(async () => { listeners.forEach(listener => listener('active')); });
  await waitFor(() => expect(screen.getByText('Notifications are off.')).toBeTruthy());
  expect(screen.getByText('Continue to plans')).toBeTruthy();
});

test('a failed permission read falls back to the optional reminder choice', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error('Permission status unavailable'));
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('We can notify you before your trial ends.')).toBeTruthy());
  expect(Notifications.getPermissionsAsync).toHaveBeenCalled();
  expect(screen.getByTestId('trial-reminder-skip')).toBeTruthy();
});

test('a two-day trial does not offer an unschedulable reminder', async () => {
  mockOffering = { annual: shortAnnual, monthly: null };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('Review your trial before it ends.')).toBeTruthy());
  expect(screen.queryByText('We can notify you before your trial ends.')).toBeNull();
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('an eligible longer trial can offer a reminder when another plan has only two days', async () => {
  mockOffering = { annual: shortAnnual, monthly };
  mockEligibility = { annual: true, monthly: true };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('We can notify you before your trial ends.')).toBeTruthy());
  expect(screen.getByTestId('trial-reminder-skip')).toBeTruthy();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('a longer annual trial offers a reminder even when the monthly trial is short', async () => {
  mockOffering = { annual, monthly: shortMonthly };
  mockEligibility = { annual: true, monthly: true };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('We can notify you before your trial ends.')).toBeTruthy());
  expect(screen.getByTestId('trial-reminder-skip')).toBeTruthy();
});

test('an ineligible annual offer does not hide an eligible longer monthly trial', async () => {
  mockOffering = { annual, monthly };
  mockEligibility = { annual: false, monthly: true };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('We can notify you before your trial ends.')).toBeTruthy());
  expect(screen.getByTestId('trial-reminder-skip')).toBeTruthy();
});

test('an ineligible long offer cannot make the sole short eligible trial look schedulable', async () => {
  mockOffering = { annual, monthly: shortMonthly };
  mockEligibility = { annual: false, monthly: true };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('Review your trial before it ends.')).toBeTruthy());
  expect(screen.queryByTestId('trial-reminder-skip')).toBeNull();
});

test('two short eligible trials do not offer an unschedulable reminder', async () => {
  mockOffering = { annual: shortAnnual, monthly: shortMonthly };
  mockEligibility = { annual: true, monthly: true };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('Review your trial before it ends.')).toBeTruthy());
  expect(screen.queryByTestId('trial-reminder-skip')).toBeNull();
});

test('a calendar-month trial can offer a reminder using its confirmed end date', async () => {
  mockOffering = { annual: { product: { ...annual.product, introPrice: { ...annual.product.introPrice, period: 'P1M' } } }, monthly: null };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getByText('We can notify you before your trial ends.')).toBeTruthy());
  expect(screen.getByTestId('trial-reminder-skip')).toBeTruthy();
});

test('a saved reminder checkpoint returns to trial retry when plans are unavailable', async () => {
  mockOffering = null;
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial'));
  expect(screen.queryByText('Choose a plan')).toBeNull();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
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
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: false, trial: true });
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('existing meal reminders stay enabled when opting in to trial reminders', async () => {
  await saveReminderPreferences('trial-buyer', { meals: true, trial: false });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: true, trial: true });
});

test.each(['denied', 'error', 'skip'])('%s continues to plans without saving a false opt-in', async outcome => {
  if (outcome === 'error') (Notifications.requestPermissionsAsync as jest.Mock).mockRejectedValue(new Error('Permission unavailable'));
  else (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await screen.findByTestId(outcome === 'skip' ? 'trial-reminder-skip' : 'trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId(outcome === 'skip' ? 'trial-reminder-skip' : 'trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: false, trial: false });
  if (outcome === 'skip') expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});


test('a late permission response cannot navigate after the reminder screen loses focus', async () => {
  const pushToken = jest.spyOn(useNotifications, 'getExpoPushTokenAsync');
  let resolve!: (result: { status: string }) => void;
  (Notifications.requestPermissionsAsync as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await act(async () => { fireEvent.press(screen.getByText('Continue to reminder')); });
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await act(async () => { router.back(); });
  expect(screen.getPathname()).toBe('/welcome/trial');
  await act(async () => { resolve({ status: 'granted' }); });
  expect(screen.getPathname()).toBe('/welcome/trial');
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: false, trial: false });
  expect(pushToken).not.toHaveBeenCalled();
});

test('a late preference read cannot opt in after leaving the reminder screen', async () => {
  const pushToken = jest.spyOn(useNotifications, 'getExpoPushTokenAsync');
  const write = jest.spyOn(AsyncStorage, 'setItem');
  const originalGetItem = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
  let resolve!: (value: string | null) => void;
  const pendingRead = new Promise<string | null>(done => { resolve = done; });
  const read = (AsyncStorage.getItem as jest.Mock).mockImplementation(key =>
    key === '@fitsy/reminder-preferences/trial-buyer' ? pendingRead : originalGetItem(key));
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await act(async () => { fireEvent.press(screen.getByText('Continue to reminder')); });
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(read).toHaveBeenCalledWith('@fitsy/reminder-preferences/trial-buyer'));
  await act(async () => { router.back(); });
  expect(screen.getPathname()).toBe('/welcome/trial');
  await act(async () => { resolve('{}'); });
  read.mockImplementation(originalGetItem);
  expect(write).not.toHaveBeenCalledWith('@fitsy/reminder-preferences/trial-buyer', expect.anything());
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: false, trial: false });
  expect(pushToken).not.toHaveBeenCalled();
});

test('a failed preference read keeps existing meal reminders and continues to plans', async () => {
  await saveReminderPreferences('trial-buyer', { meals: true, trial: false });
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: true, trial: false });
  const write = jest.spyOn(AsyncStorage, 'setItem');
  const pushToken = jest.spyOn(useNotifications, 'getExpoPushTokenAsync');
  const originalGetItem = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
  let failed = false;
  const read = (AsyncStorage.getItem as jest.Mock).mockImplementation(key => {
    if (key === '@fitsy/reminder-preferences/trial-buyer' && !failed) {
      failed = true;
      return Promise.reject(new Error('Storage unavailable'));
    }
    return originalGetItem(key);
  });
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial-reminder' });
  await screen.findByTestId('trial-reminder-allow');
  await act(async () => { fireEvent.press(screen.getByTestId('trial-reminder-allow')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(failed).toBe(true);
  expect(write).not.toHaveBeenCalledWith('@fitsy/reminder-preferences/trial-buyer', expect.stringContaining('"meals":false'));
  expect(await originalGetItem('@fitsy/reminder-preferences/trial-buyer')).toBe('{"meals":true,"trial":false}');
  read.mockImplementation(originalGetItem);
  expect(await readReminderPreferences('trial-buyer')).toEqual({ meals: true, trial: false });
  expect(pushToken).not.toHaveBeenCalled();
});
