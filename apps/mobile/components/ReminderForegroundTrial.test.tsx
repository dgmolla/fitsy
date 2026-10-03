jest.unmock('react-native');
import React from 'react';
import { Alert, Pressable, Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReminderProvider, useReminders } from '../lib/useReminders';
import { readReminderPreferences, replaceReminders, saveReminderPreferences } from '../lib/notificationSchedule';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/notification-settings' }));
jest.mock('posthog-react-native', () => jest.fn().mockImplementation(() => ({ capture: jest.fn() })));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  getLastNotificationResponseAsync: async () => null,
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));
let mockAccountId = 'reminder-owner';
jest.mock('../lib/supabase', () => ({ supabase: { auth: {
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  getSession: async () => ({ data: { session: { user: { id: mockAccountId } } } }),
} } }));
const mockRefresh = jest.fn(async () => {});
const mockCustomerInfo = { entitlements: { all: { pro: { isActive: true } } } };
let mockCustomerInfoResult: typeof mockCustomerInfo | null = mockCustomerInfo;
let mockEntitled: boolean | null = true;
jest.mock('../lib/usePurchases', () => ({ usePurchases: () => ({
  entitled: mockEntitled, ready: true, refresh: mockRefresh,
  customerInfo: mockCustomerInfoResult,
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
  mockCustomerInfoResult = mockCustomerInfo;
  mockEntitled = true;
  jest.clearAllMocks();
  jest.mocked(readReminderPreferences).mockReset();
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' } as Notifications.NotificationPermissionsStatus);
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

test('a due reminder is not reported as unavailable just because its pending request fired', async () => {
  const now = Date.now();
  const expiry = now + 36 * 3_600_000;
  mockCustomerInfo.entitlements.all.pro = {
    isActive: true, periodType: 'TRIAL', willRenew: true,
    latestPurchaseDate: new Date(now - 5 * 24 * 3_600_000).toISOString(),
    expirationDate: new Date(expiry).toISOString(),
  } as typeof mockCustomerInfo.entitlements.all.pro;
  try {
    jest.mocked(readReminderPreferences).mockResolvedValue({ meals: false, trial: true });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<ReminderProvider><TrialToggle /></ReminderProvider>);
    await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
  } finally { mockCustomerInfo.entitlements.all.pro = { isActive: true }; }
});

test('enabling trial reminders after the 48-hour send time explains the missed window', async () => {
  const now = Date.now();
  mockCustomerInfo.entitlements.all.pro = {
    isActive: true, periodType: 'TRIAL', willRenew: true,
    latestPurchaseDate: new Date(now - 5 * 24 * 3_600_000).toISOString(),
    expirationDate: new Date(now + 36 * 3_600_000).toISOString(),
  } as typeof mockCustomerInfo.entitlements.all.pro;
  try {
    jest.mocked(readReminderPreferences).mockResolvedValue({ meals: false, trial: false });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<ReminderProvider><TrialToggle /></ReminderProvider>);
    await waitFor(() => expect(screen.getByText('Trial reminder off')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('trial-toggle')); });
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Trial reminder time passed',
      expect.stringContaining('cannot schedule it now')));
    expect(saveReminderPreferences).toHaveBeenCalledWith('reminder-owner', { meals: false, trial: true });
  } finally { mockCustomerInfo.entitlements.all.pro = { isActive: true }; }
});

test('a late opt-in waits for native subscription details before explaining the missed window', async () => {
  const now = Date.now();
  mockCustomerInfoResult = null;
  jest.mocked(readReminderPreferences).mockResolvedValue({ meals: false, trial: false });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<ReminderProvider><TrialToggle /></ReminderProvider>);
  await waitFor(() => expect(replaceReminders).toHaveBeenCalledWith('reminder-owner', [], undefined));
  expect(screen.getByText('Trial reminder off')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('trial-toggle')); });
  await waitFor(() => expect(saveReminderPreferences).toHaveBeenCalledWith('reminder-owner', { meals: false, trial: true }));
  expect(alert).not.toHaveBeenCalled();
  mockCustomerInfo.entitlements.all.pro = {
    isActive: true, periodType: 'TRIAL', willRenew: true,
    latestPurchaseDate: new Date(now - 5 * 24 * 3_600_000).toISOString(),
    expirationDate: new Date(now + 36 * 3_600_000).toISOString(),
  } as typeof mockCustomerInfo.entitlements.all.pro;
  try {
    mockCustomerInfoResult = mockCustomerInfo;
    mockEntitled = false;
    screen.rerender(<ReminderProvider><TrialToggle /></ReminderProvider>);
    expect(alert).not.toHaveBeenCalled();
    mockEntitled = true;
    screen.rerender(<ReminderProvider><TrialToggle /></ReminderProvider>);
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Trial reminder time passed',
      expect.stringContaining('cannot schedule it now')));
    expect(alert).toHaveBeenCalledTimes(1);
  } finally { mockCustomerInfo.entitlements.all.pro = { isActive: true }; }
});

test('a due reminder with revoked device permission reports uncertain delivery', async () => {
  const now = Date.now();
  mockCustomerInfo.entitlements.all.pro = {
    isActive: true, periodType: 'TRIAL', willRenew: true,
    latestPurchaseDate: new Date(now - 5 * 24 * 3_600_000).toISOString(),
    expirationDate: new Date(now + 36 * 3_600_000).toISOString(),
  } as typeof mockCustomerInfo.entitlements.all.pro;
  try {
    jest.mocked(readReminderPreferences).mockResolvedValue({ meals: false, trial: true });
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'denied' } as Notifications.NotificationPermissionsStatus);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<ReminderProvider><TrialToggle /></ReminderProvider>);
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Trial reminder status unknown', expect.stringContaining('cannot confirm whether')));
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
  expect(replaceReminders).toHaveBeenCalledWith('reminder-owner', expect.arrayContaining([expect.objectContaining({ kind: 'trial' })]), 'presented-current-account-trial');
  mockCustomerInfo.entitlements.all.pro = { isActive: true };
});
