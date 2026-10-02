jest.unmock('react-native');
import React from 'react';
import { Alert, AppState, Pressable, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReminderProvider, useReminders } from '../lib/useReminders';
import { readReminderPreferences, reconcileReminderOwnership, replaceReminders } from '../lib/notificationSchedule';
import { reconcileDevTrialReminderOwnership } from '../lib/devTrialReminderProbe';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/notification-settings' }));
jest.mock('posthog-react-native', () => jest.fn().mockImplementation(() => ({ capture: jest.fn() })));
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
jest.mock('../lib/devTrialReminderProbe', () => ({ reconcileDevTrialReminderOwnership: jest.fn(async () => {}) }));

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
function TrialToggle() {
  const { preferences, save } = useReminders();
  return <Pressable testID="trial-toggle" onPress={() => void save({ ...preferences, trial: !preferences.trial })}>
    <Text>{preferences.trial ? 'Trial reminder on' : 'Trial reminder off'}</Text>
  </Pressable>;
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
  expect(reconcileDevTrialReminderOwnership).toHaveBeenCalledWith('next-owner');
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

test('a native trial scheduling failure tells the buyer the reminder is unconfirmed', async () => {
  const now = Date.now();
  mockCustomerInfo.entitlements.all.pro = {
    isActive: true, periodType: 'TRIAL', willRenew: true,
    latestPurchaseDate: new Date(now).toISOString(),
    expirationDate: new Date(now + 7 * 24 * 3_600_000).toISOString(),
  } as typeof mockCustomerInfo.entitlements.all.pro;
  jest.mocked(readReminderPreferences).mockResolvedValue({ meals: false, trial: true });
  jest.mocked(replaceReminders).mockImplementation(async (_id, jobs) => {
    if (jobs.some(job => job.kind === 'trial')) throw new Error('Native schedule failed');
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  render(<ReminderProvider><SettingsView /></ReminderProvider>);
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Trial reminder unavailable', expect.stringContaining('Check your trial end date')));
  expect(warn).toHaveBeenCalledWith('[reminders]', 'Native schedule failed');
  mockCustomerInfo.entitlements.all.pro = { isActive: true };
});

test('opt-out and retry warns again when native trial scheduling still fails', async () => {
  const now = Date.now();
  mockCustomerInfo.entitlements.all.pro = {
    isActive: true, periodType: 'TRIAL', willRenew: true,
    latestPurchaseDate: new Date(now).toISOString(),
    expirationDate: new Date(now + 7 * 24 * 3_600_000).toISOString(),
  } as typeof mockCustomerInfo.entitlements.all.pro;
  try {
    jest.mocked(readReminderPreferences).mockResolvedValue({ meals: false, trial: true });
    jest.mocked(replaceReminders).mockImplementation(async (_id, jobs) => {
      if (jobs.some(job => job.kind === 'trial')) throw new Error('Native schedule failed');
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const screen = render(<ReminderProvider><TrialToggle /></ReminderProvider>);
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    await act(async () => { fireEvent.press(screen.getByTestId('trial-toggle')); });
    await waitFor(() => expect(screen.getByText('Trial reminder off')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('trial-toggle')); });
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  } finally { mockCustomerInfo.entitlements.all.pro = { isActive: true }; }
});

test('a silently skipped trial job also tells the buyer the reminder is unconfirmed', async () => {
  const now = Date.now();
  mockCustomerInfo.entitlements.all.pro = {
    isActive: true, periodType: 'TRIAL', willRenew: true,
    latestPurchaseDate: new Date(now).toISOString(),
    expirationDate: new Date(now + 7 * 24 * 3_600_000).toISOString(),
  } as typeof mockCustomerInfo.entitlements.all.pro;
  jest.mocked(readReminderPreferences).mockResolvedValue({ meals: false, trial: true });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<ReminderProvider><SettingsView /></ReminderProvider>);
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Trial reminder unavailable', expect.stringContaining('Check your trial end date')));
  expect(replaceReminders).toHaveBeenCalledWith('reminder-owner', expect.arrayContaining([expect.objectContaining({ kind: 'trial' })]));
  mockCustomerInfo.entitlements.all.pro = { isActive: true };
});
