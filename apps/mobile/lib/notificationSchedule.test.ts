import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { planReminders, REMINDER_PREFIX } from './notificationPlan';
import { readReminderPreferences, readScheduledReminders, saveReminderPreferences, replaceReminders, reminderDestination, REMINDER_CHANNEL } from './notificationSchedule';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn(), cancelScheduledNotificationAsync: jest.fn(),
  getPresentedNotificationsAsync: jest.fn(), dismissNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(), scheduleNotificationAsync: jest.fn(), setNotificationChannelAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' }, AndroidImportance: { DEFAULT: 3 },
}));
const sdk = jest.mocked(Notifications);
const storage = jest.mocked(AsyncStorage);
const pending = new Map<string, Notifications.NotificationRequestInput>();
const initialPlatform = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks(); pending.clear();
  sdk.getAllScheduledNotificationsAsync.mockImplementation(async () => [...pending.values()] as Notifications.NotificationRequest[]);
  sdk.cancelScheduledNotificationAsync.mockImplementation(async id => { pending.delete(id); });
  sdk.getPresentedNotificationsAsync.mockResolvedValue([]);
  sdk.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as Notifications.NotificationPermissionsStatus);
  sdk.scheduleNotificationAsync.mockImplementation(async request => { pending.set(request.identifier!, request); return request.identifier!; });
  storage.getItem.mockResolvedValue(null); storage.setItem.mockResolvedValue();
});
afterEach(() => { Platform.OS = initialPlatform; });
const plan = () => planReminders({ now: new Date(), userId: 'one', entitled: true, preferences: { meals: true, trial: false } });

test('preferences are scoped by account and malformed or missing storage stays opted out', async () => {
  await saveReminderPreferences('one', { meals: true, trial: false });
  expect(storage.setItem).toHaveBeenCalledWith('@fitsy/reminder-preferences/one', '{"meals":true,"trial":false}');
  expect(await readReminderPreferences('two')).toEqual({ meals: false, trial: false });
  expect(storage.getItem).toHaveBeenLastCalledWith('@fitsy/reminder-preferences/two');
  storage.getItem.mockResolvedValue('invalid');
  expect(await readReminderPreferences('one')).toEqual({ meals: false, trial: false });
  storage.getItem.mockResolvedValue('{"meals":"yes","trial":true}');
  expect(await readReminderPreferences('one')).toEqual({ meals: false, trial: true });
});
test('reconciliation is idempotent and preserves other feature notifications', async () => {
  pending.set('launch-announcement', { identifier: 'launch-announcement', content: {}, trigger: null });
  const reminders = plan();
  await replaceReminders('one', reminders); await replaceReminders('one', reminders);
  expect(pending.size).toBe(reminders.length + 1);
  expect(pending.has('launch-announcement')).toBe(true);
  expect(await readScheduledReminders('one')).toEqual(reminders.map(r => ({ kind: r.kind, date: r.date.toISOString() })));
  expect(await readScheduledReminders('two')).toEqual([]);
  expect(sdk.getPermissionsAsync).toHaveBeenCalledTimes(2);
  await replaceReminders(null, []);
  expect([...pending.keys()]).toEqual(['launch-announcement']);
});
test('permission denial cancels prior reminders and never prompts or schedules', async () => {
  await replaceReminders('one', plan());
  sdk.getPermissionsAsync.mockResolvedValue({ status: 'denied' } as Notifications.NotificationPermissionsStatus);
  sdk.scheduleNotificationAsync.mockClear();
  await replaceReminders('one', plan());
  expect(pending.size).toBe(0); expect(sdk.scheduleNotificationAsync).not.toHaveBeenCalled();
});
test('an opt-out queued during a native schedule removes that late request', async () => {
  let release!: () => void; let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  sdk.scheduleNotificationAsync.mockImplementationOnce(async request => {
    started(); await new Promise<void>(resolve => { release = resolve; });
    pending.set(request.identifier!, request); return request.identifier!;
  });
  const old = replaceReminders('one', plan()); await entered;
  const latest = replaceReminders(null, []); release(); await Promise.all([old, latest]);
  expect(sdk.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(pending.size).toBe(0);
});
test('Android gets a channel and portable date triggers', async () => {
  Platform.OS = 'android'; await replaceReminders('one', plan());
  expect(sdk.setNotificationChannelAsync).toHaveBeenCalledWith(REMINDER_CHANNEL, expect.objectContaining({ importance: 3 }));
  const request = sdk.scheduleNotificationAsync.mock.calls[0][0];
  expect(request.trigger).toMatchObject({ type: 'date', channelId: REMINDER_CHANNEL });
  expect(request.content.data).toMatchObject({ userId: 'one', kind: 'meal' });
});
test('sign-out clears already delivered reminders without dismissing other features', async () => {
  sdk.getPresentedNotificationsAsync.mockResolvedValue([
    { request: { identifier: REMINDER_PREFIX + 'old', content: { data: { userId: 'one', kind: 'meal' } } } },
    { request: { identifier: 'launch-announcement', content: { data: {} } } },
  ] as Notifications.Notification[]);
  await replaceReminders(null, []);
  expect(sdk.dismissNotificationAsync.mock.calls).toEqual([[REMINDER_PREFIX + 'old']]);
});
test('tap destinations require the current account and a supported reminder kind', () => {
  expect(reminderDestination({ userId: 'one', kind: 'meal' }, 'one')).toBe('/(tabs)/search');
  expect(reminderDestination({ userId: 'one', kind: 'trial' }, 'one')).toBe('/notification-settings');
  expect(reminderDestination({ userId: 'one', kind: 'trial' }, 'two')).toBeNull();
  expect(reminderDestination({ userId: 'one', kind: 'trial' }, null)).toBeNull();
  expect(reminderDestination({ userId: 'one', url: 'https://untrusted.invalid' }, 'one')).toBeNull();
});
