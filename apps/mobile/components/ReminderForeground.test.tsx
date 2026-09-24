jest.unmock('react-native');
import React from 'react';
import { AppState, Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { ReminderProvider, useReminders } from '../lib/useReminders';
import { readReminderPreferences, replaceReminders } from '../lib/notificationSchedule';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/notification-settings' }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  getLastNotificationResponseAsync: async () => null,
}));
jest.mock('../lib/supabase', () => ({ supabase: { auth: {
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  getSession: async () => ({ data: { session: { user: { id: 'reminder-owner' } } } }),
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
  subscribeReminderPreferences: () => () => {},
  saveReminderPreferences: jest.fn(),
  reminderDestination: jest.fn(),
}));

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
  act(() => { foreground?.('active'); });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('Meal reminders on')).toBeTruthy();
  expect(replace.mock.calls.some(([id, jobs]) => id === 'reminder-owner' && jobs.length === 0)).toBe(false);
});
