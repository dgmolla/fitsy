jest.unmock('react-native');
import React from 'react';
import { AppState, Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { ReminderProvider, useReminders } from '../lib/useReminders';
import { readReminderPreferences, reconcileReminderOwnership, replaceReminders } from '../lib/notificationSchedule';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/notification-settings' }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  getLastNotificationResponseAsync: async () => null,
}));
let mockAccountId = 'reminder-owner';
let mockAuthListener: ((event: string, session: { user: { id: string } }) => void) | undefined;
jest.mock('../lib/supabase', () => ({ supabase: { auth: {
  onAuthStateChange: (listener: typeof mockAuthListener) => { mockAuthListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
  getSession: async () => ({ data: { session: { user: { id: mockAccountId } } } }),
} } }));
const mockRefresh = jest.fn(async () => {});
const mockCustomerInfo = { entitlements: { all: { pro: { isActive: true } } } };
jest.mock('../lib/usePurchases', () => ({ usePurchases: () => ({
  entitled: true, ready: true, refresh: mockRefresh,
  customerInfo: mockCustomerInfo,
}) }));
jest.mock('../lib/notificationSchedule', () => ({
  readReminderPreferences: jest.fn(),
  readScheduledReminders: jest.fn(async () => []),
  replaceReminders: jest.fn(async () => {}),
  reconcileReminderOwnership: jest.fn(async () => {}),
  subscribeReminderPreferences: () => () => {},
  saveReminderPreferences: jest.fn(),
  reminderDestination: jest.fn(),
}));

beforeEach(() => {
  mockAccountId = 'reminder-owner';
  mockAuthListener = undefined;
  jest.clearAllMocks();
  jest.mocked(readReminderPreferences).mockReset();
});
afterEach(() => { jest.restoreAllMocks(); });

function SettingsView() {
  const { preferences } = useReminders();
  return <Text>{preferences.meals ? 'Meal reminders on' : 'Meal reminders off'}</Text>;
}

test('a foreground storage failure keeps enabled meal reminders and their planned jobs', async () => {
  const read = jest.mocked(readReminderPreferences);
  const replace = jest.mocked(replaceReminders);
  read.mockResolvedValue({ meals: true, trial: false });
  let foreground: ((state: string) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    foreground = listener as (state: string) => void;
    return { remove() {} } as ReturnType<typeof AppState.addEventListener>;
  });
  const screen = render(<ReminderProvider><SettingsView /></ReminderProvider>);
  await waitFor(() => expect(screen.getByText('Meal reminders on')).toBeTruthy());
  await waitFor(() => expect(replace.mock.calls.some(([id, jobs]) => id === 'reminder-owner' && jobs.some(job => job.kind === 'meal'))).toBe(true));
  replace.mockClear();
  read.mockImplementationOnce(async (_id, options) => {
    if (options?.throwOnError) throw new Error('Storage temporarily unavailable');
    return { meals: false, trial: false };
  });
  await act(async () => { foreground?.('active'); });
  await waitFor(() => expect(read.mock.calls.filter(([id]) => id === 'reminder-owner')).toHaveLength(2));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('Meal reminders on')).toBeTruthy();
  expect(replace.mock.calls.some(([id, jobs]) => id === 'reminder-owner' && jobs.length === 0)).toBe(false);
});

test('switching accounts clears prior meal reminders when the new account storage read fails', async () => {
  mockAccountId = 'reminder-owner';
  const read = jest.mocked(readReminderPreferences);
  const replace = jest.mocked(replaceReminders);
  read.mockResolvedValue({ meals: true, trial: false });
  const screen = render(<ReminderProvider><SettingsView /></ReminderProvider>);
  await waitFor(() => expect(screen.getByText('Meal reminders on')).toBeTruthy());
  await waitFor(() => expect(replace.mock.calls.some(([id, jobs]) => id === 'reminder-owner' && jobs.some(job => job.kind === 'meal'))).toBe(true));
  replace.mockClear();
  mockAccountId = 'next-owner';
  read.mockImplementationOnce(async (_id, options) => {
    if (options?.throwOnError) throw new Error('Storage temporarily unavailable');
    return { meals: false, trial: false };
  });
  await act(async () => { mockAuthListener?.('SIGNED_IN', { user: { id: 'next-owner' } }); });
  await waitFor(() => expect(read).toHaveBeenCalledWith('next-owner', { throwOnError: true }));
  expect(screen.getByText('Meal reminders off')).toBeTruthy();
  expect(reconcileReminderOwnership).toHaveBeenCalledWith('next-owner');
  expect(replace).not.toHaveBeenCalledWith(null, []);
});

test('cold launch read failure preserves the current account scheduled jobs', async () => {
  mockAccountId = 'reminder-owner';
  const read = jest.mocked(readReminderPreferences);
  const replace = jest.mocked(replaceReminders);
  read.mockImplementation(async (id, options) => {
    if (id === 'reminder-owner' && options?.throwOnError) throw new Error('Storage temporarily unavailable');
    return { meals: false, trial: false };
  });
  const screen = render(<ReminderProvider><SettingsView /></ReminderProvider>);
  await waitFor(() => expect(read).toHaveBeenCalledWith('reminder-owner', { throwOnError: true }));
  expect(screen.getByText('Meal reminders off')).toBeTruthy();
  expect(reconcileReminderOwnership).toHaveBeenCalledWith('reminder-owner');
  expect(replace).not.toHaveBeenCalledWith(null, []);
});

test('foreground recovery retries failed account ownership cleanup', async () => {
  const read = jest.mocked(readReminderPreferences);
  const reconcile = jest.mocked(reconcileReminderOwnership);
  read.mockResolvedValue({ meals: true, trial: false });
  let foreground: ((state: string) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    foreground = listener as (state: string) => void;
    return { remove() {} } as ReturnType<typeof AppState.addEventListener>;
  });
  const screen = render(<ReminderProvider><SettingsView /></ReminderProvider>);
  await waitFor(() => expect(screen.getByText('Meal reminders on')).toBeTruthy());
  await waitFor(() => expect(reconcile).toHaveBeenCalledWith('reminder-owner'));
  reconcile.mockImplementationOnce(async () => { throw new Error('Notification query unavailable'); });
  read.mockImplementation(async (id, options) => {
    if (id === 'next-owner' && options?.throwOnError) throw new Error('Storage temporarily unavailable');
    return { meals: true, trial: false };
  });
  await act(async () => { mockAuthListener?.('SIGNED_IN', { user: { id: 'next-owner' } }); });
  await waitFor(() => expect(read).toHaveBeenCalledWith('next-owner', { throwOnError: true }));
  expect(reconcile.mock.calls.filter(([id]) => id === 'next-owner')).toHaveLength(1);
  await act(async () => { foreground?.('active'); });
  await waitFor(() => expect(reconcile.mock.calls.filter(([id]) => id === 'next-owner')).toHaveLength(2));
});
