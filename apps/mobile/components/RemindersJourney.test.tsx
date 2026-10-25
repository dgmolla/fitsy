jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Stack } from 'expo-router';
import Purchases from 'react-native-purchases';
import { mockState, routes, renderJourney, response, withAccountProfile, Alert, ExpoNotifications, act, fireEvent, waitFor, router, readReminderPreferences } from './OnboardingNavigationHarness';
import NotificationSettings from '../app/notification-settings';
import { ReminderProvider } from '../lib/useReminders';
import { PurchasesProvider } from '../lib/usePurchases';

const { loadAll } = require('js-yaml');
type Step = {
  launchApp?: { clearState?: boolean; clearKeychain?: boolean; permissions?: { notifications: string } };
  retry?: { maxRetries: number; commands: {
    runFlow?: { when: { visible: string }; commands: { tapOn: string }[] };
    extendedWaitUntil?: { visible: { id: string }; timeout: number };
  }[] };
  openLink?: string;
  tapOn?: string | { id?: string };
};
const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/reminders.yaml'), 'utf8')) as [unknown, Step[]];
const reminderRoutes = {
  ...routes,
  _layout: () => <PurchasesProvider><ReminderProvider><Stack screenOptions={{ headerShown: false }} /></ReminderProvider></PurchasesProvider>,
  'notification-settings': NotificationSettings,
};

// Only native and transport boundaries are replaced. Real sign-in routing,
// settings, preferences, entitlement reconciliation and scheduling run together.
const native = {
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  getLastNotificationResponseAsync: async () => null,
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
};
Object.assign(ExpoNotifications, native);

beforeEach(() => {
  native.scheduleNotificationAsync.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Purchases, 'getAppUserID').mockResolvedValue('buyer');
  jest.spyOn(Purchases, 'isAnonymous').mockResolvedValue(false);
  global.fetch = jest.fn(withAccountProfile(async url => response(url.endsWith('/api/auth/login')
    ? { token: 'test-token', refreshToken: 'refresh', user: { id: 'buyer' }, isNewUser: false }
    : { active: false, verdict: 'never_subscribed', synced: true, stale: false, lastRcVerifiedAt: new Date().toISOString() })));
});

test('both permission resets reconnect a cleared Debug client before driving the guest screen', () => {
  const resets = commands.flatMap((step, index) => step.launchApp?.clearState ? [index] : []);
  expect(resets).toHaveLength(2);
  for (const index of resets) {
    expect(commands[index]!.launchApp).toEqual({ clearState: true, clearKeychain: true, permissions: { notifications: 'unset' } });
    const startup = commands[index + 1]?.retry;
    expect(startup?.maxRetries).toBeLessThanOrEqual(2);
    const launcher = startup?.commands.find(step => step.runFlow)?.runFlow;
    expect(launcher?.when).toEqual({ visible: 'Development Build' });
    const server = new RegExp(launcher!.commands[0]!.tapOn);
    expect(server.test('http://localhost:8081')).toBe(true); // loopback test fixture
    expect(server.test('http://127.0.0.1:8099')).toBe(true); // loopback test fixture
    expect(server.test('http://localhost.evil:8081')).toBe(false);
    expect(startup?.commands.find(step => step.extendedWaitUntil)?.extendedWaitUntil?.visible).toEqual({ id: 'welcome-start' });
  }
});

test.each(['denied', 'granted'] as const)('the saved reminder journey can request %s permission without a purchase or trial offer', async outcome => {
  let permission: string = 'undetermined';
  jest.mocked(ExpoNotifications.getPermissionsAsync).mockImplementation(async () => ({ status: permission }) as ExpoNotifications.NotificationPermissionsStatus);
  jest.mocked(ExpoNotifications.requestPermissionsAsync).mockImplementation(async () => {
    permission = outcome;
    return { status: outcome } as ExpoNotifications.NotificationPermissionsStatus;
  });
  const guest = renderJourney('/notification-settings', reminderRoutes);
  await guest.findByText('Device notifications are off');
  expect(guest.getByTestId('reminders-empty')).toBeTruthy();
  expect(guest.queryByTestId('reminders-enable')).toBeNull();
  expect(ExpoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => { guest.unmount(); });

  const screen = renderJourney('/welcome/signin', reminderRoutes);
  const logins = commands.flatMap((step, index) => step.tapOn === 'Dev login' || (typeof step.tapOn === 'object' && step.tapOn.id === 'signup-dev') ? [index] : []);
  expect(logins).toHaveLength(2);
  const login = logins[outcome === 'denied' ? 0 : 1]!;
  const signup = await screen.findByTestId('signup-dev');
  await act(async () => { fireEvent.press(signup); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial'));
  // The SDK boundary emits SIGNED_IN after successful session adoption.
  await act(async () => { for (const listener of mockState.authListeners) listener('SIGNED_IN', mockState.session); });

  const nextLink = commands.findIndex((step, index) => index > login && step.openLink !== undefined);
  expect(commands[nextLink]?.openLink).toBe('com.fitsy.mobile://notification-settings');
  await act(async () => { router.push('/notification-settings'); });
  await screen.findByTestId('reminders-enable');
  expect(screen.getByText('Reminders start with your active Fitsy subscription.')).toBeTruthy();
  expect(screen.queryByTestId('reminder-meals-toggle')).toBeNull();
  expect(screen.queryByTestId('reminder-trial-toggle')).toBeNull();
  expect(ExpoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();

  if (outcome === 'denied') {
    await act(async () => { fireEvent.press(screen.getByTestId('reminders-back')); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial'));
    await act(async () => { router.push('/notification-settings'); });
    await screen.findByTestId('reminders-enable');
    expect(ExpoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  }

  const optIn = commands.slice(nextLink + 1).find(step => typeof step.tapOn === 'object' && step.tapOn.id === 'reminders-enable');
  expect(optIn?.tapOn).toEqual({ id: 'reminders-enable' });
  await act(async () => { fireEvent.press(screen.getByTestId((optIn!.tapOn as { id: string }).id)); });
  const permissionLabel = outcome === 'granted' ? 'Device notifications allowed' : 'Device notifications are off';
  await screen.findByText(permissionLabel);
  expect(ExpoNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  if (outcome === 'denied') expect(Alert.alert).toHaveBeenCalledWith('Notifications are off', expect.any(String));
  expect(await readReminderPreferences('buyer')).toEqual({ meals: outcome === 'granted', trial: outcome === 'granted' });
  expect(screen.getByTestId('reminders-empty')).toBeTruthy();
  expect(native.scheduleNotificationAsync).not.toHaveBeenCalled();

  await act(async () => { screen.unmount(); });
  const restarted = renderJourney('/notification-settings', reminderRoutes);
  await restarted.findByText(permissionLabel);
  expect(restarted.getByTestId('reminders-empty')).toBeTruthy();
  expect(ExpoNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(native.scheduleNotificationAsync).not.toHaveBeenCalled();
  await act(async () => { restarted.unmount(); });
});
