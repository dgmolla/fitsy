import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { planReminders, REMINDER_PREFIX } from './notificationPlan';
import { readReminderPreferences, readScheduledReminders, saveReminderPreferences, replaceReminders, reconcileReminderOwnership, reminderDestination, REMINDER_CHANNEL } from './notificationSchedule';
import { clearDevTrialReminder, reconcileDevTrialReminderOwnership, scheduleDevTrialReminder } from './devTrialReminderProbe';

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
test('a seven-day trial creates exactly one native day-six request on a fixed clock', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 8, 7, 9));
  try {
    const expiration = new Date(2026, 8, 14, 12);
    const trial = planReminders({ now: new Date(), userId: 'one', entitled: true,
      preferences: { meals: false, trial: true },
      subscription: { isActive: true, periodType: 'TRIAL', willRenew: true,
        latestPurchaseDate: new Date(2026, 8, 7, 9).toISOString(), expirationDate: expiration.toISOString() } });
    await replaceReminders('one', trial);
    await replaceReminders('one', trial);
    expect(pending.size).toBe(1);
    expect(await readScheduledReminders('one')).toEqual([{ kind: 'trial', date: trial[0].date.toISOString() }]);
    expect(trial[0].date.getTime()).toBeLessThan(expiration.getTime() - 24 * 3_600_000);
    expect(sdk.scheduleNotificationAsync.mock.calls.at(-1)?.[0].trigger).toMatchObject({ type: 'date', date: trial[0].date });
    await replaceReminders('one', []);
    expect(pending.size).toBe(0);
  } finally { jest.useRealTimers(); }
});
test('an update after the new lead time keeps a valid future reminder for the same trial', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 8, 15));
  try {
    const expiration = new Date(2026, 9, 10, 12);
    const oldTime = new Date(2026, 9, 8, 19);
    const identifier = `${REMINDER_PREFIX}trial.${expiration.getTime()}`;
    pending.set(identifier, { identifier, content: { data: { userId: 'one', kind: 'trial', scheduledFor: oldTime.toISOString() } }, trigger: null });
    const plan = planReminders({ now: new Date(), userId: 'one', entitled: true,
      preferences: { meals: false, trial: true }, subscription: { isActive: true, periodType: 'TRIAL', willRenew: true,
        latestPurchaseDate: new Date(2026, 8, 26, 12).toISOString(), expirationDate: expiration.toISOString() } });
    expect(plan).toEqual([]);
    await replaceReminders('one', plan, expiration.getTime());
    expect(pending.has(identifier)).toBe(true);
    await replaceReminders('one', plan);
    expect(pending.has(identifier)).toBe(false);
  } finally { jest.useRealTimers(); }
});
test('post-due reconciliation keeps the owner\'s unread trial notice until sign-out', async () => {
  const expiration = Date.now() + 36 * 3_600_000;
  const identifier = `${REMINDER_PREFIX}trial.${expiration}`;
  sdk.getPresentedNotificationsAsync.mockResolvedValue([{ request: { identifier,
    content: { data: { userId: 'one', kind: 'trial' } } } }] as unknown as Notifications.Notification[]);
  await replaceReminders('one', [], expiration);
  expect(sdk.dismissNotificationAsync).not.toHaveBeenCalled();
  await replaceReminders(null, []);
  expect(sdk.dismissNotificationAsync).toHaveBeenCalledWith(identifier);
});
test('unresolved native identity preserves trial requests while meal jobs still reconcile', async () => {
  const expiry = Date.now() + 36 * 3_600_000;
  const identifier = `${REMINDER_PREFIX}trial.${expiry}`;
  pending.set(identifier, { identifier, content: { data: { userId: 'one', kind: 'trial', scheduledFor: new Date(Date.now() + 4 * 3_600_000).toISOString() } }, trigger: null });
  sdk.getPresentedNotificationsAsync.mockResolvedValue([{ request: { identifier,
    content: { data: { userId: 'one', kind: 'trial' } } } }] as unknown as Notifications.Notification[]);
  const meals = plan();
  await replaceReminders('one', meals, 'current-account-trial');
  expect(pending.has(identifier)).toBe(true);
  expect(pending.size).toBe(meals.length + 1);
  expect(sdk.dismissNotificationAsync).not.toHaveBeenCalled();
  await replaceReminders('one', meals);
  expect(pending.has(identifier)).toBe(false);
  expect(sdk.dismissNotificationAsync).toHaveBeenCalledWith(identifier);
});
test('development device probe uses the native bridge once, clears it, and cannot run in production', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  try {
    const realIdentifier = `${REMINDER_PREFIX}meal.real`;
    pending.set(realIdentifier, { identifier: realIdentifier, content: { data: { userId: 'one', kind: 'meal' } }, trigger: null });
    const now = new Date(2026, 8, 28, 4);
    const first = await scheduleDevTrialReminder('one', now);
    expect(first).toEqual({ count: 1, identifier: expect.stringMatching(/^fitsy\.dev-trial-reminder\./), scheduledFor: expect.any(String) });
    expect(new Date(first.scheduledFor!).getHours()).toBe(9);
    expect(pending.size).toBe(2);
    expect(await scheduleDevTrialReminder('one', now)).toEqual(first);
    expect(pending.size).toBe(2);
    expect(await clearDevTrialReminder('one')).toEqual({ count: 0, identifier: null, scheduledFor: null });
    expect([...pending.keys()]).toEqual([realIdentifier]);
    Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
    await expect(scheduleDevTrialReminder('one', now)).rejects.toThrow('Development sign-in required');
    expect(sdk.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  } finally {
    if (prior) Object.defineProperty(globalThis, '__DEV__', prior);
    else Reflect.deleteProperty(globalThis, '__DEV__');
  }
});
test('concurrent probe taps cannot duplicate and account changes remove only probe requests', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  try {
    const realIdentifier = `${REMINDER_PREFIX}meal.real`;
    pending.set(realIdentifier, { identifier: realIdentifier, content: { data: { userId: 'one' } }, trigger: null });
    const now = new Date(2026, 8, 28, 4);
    await Promise.all([scheduleDevTrialReminder('one', now), scheduleDevTrialReminder('one', now)]);
    expect([...pending.keys()].filter(id => id.startsWith('fitsy.dev-trial-reminder.'))).toHaveLength(1);
    await reconcileDevTrialReminderOwnership('two');
    expect([...pending.keys()]).toEqual([realIdentifier]);
    await scheduleDevTrialReminder('two', now);
    await reconcileDevTrialReminderOwnership(null);
    expect([...pending.keys()]).toEqual([realIdentifier]);
  } finally {
    if (prior) Object.defineProperty(globalThis, '__DEV__', prior);
    else Reflect.deleteProperty(globalThis, '__DEV__');
  }
});
test('account change during a native probe write removes the late request', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  try {
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    sdk.scheduleNotificationAsync.mockImplementationOnce(async request => {
      started(); await new Promise<void>(resolve => { release = resolve; });
      pending.set(request.identifier!, request); return request.identifier!;
    });
    const old = scheduleDevTrialReminder('one', new Date(2026, 8, 28, 4));
    await entered;
    const changed = reconcileDevTrialReminderOwnership('two');
    release(); await Promise.all([old, changed]);
    expect(pending.size).toBe(0);
  } finally {
    if (prior) Object.defineProperty(globalThis, '__DEV__', prior);
    else Reflect.deleteProperty(globalThis, '__DEV__');
  }
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
test('loading preserves pending and delivered reminders; sign-out clears only this feature', async () => {
  sdk.getPresentedNotificationsAsync.mockResolvedValue([
    { request: { identifier: REMINDER_PREFIX + 'old', content: { data: { userId: 'one', kind: 'meal' } } } },
    { request: { identifier: 'launch-announcement', content: { data: {} } } },
  ] as Notifications.Notification[]);
  await replaceReminders('one', plan());
  const before = [...pending.keys()];
  await replaceReminders(undefined, []);
  expect([...pending.keys()]).toEqual(before);
  expect(sdk.dismissNotificationAsync).not.toHaveBeenCalled();
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

test('account reconciliation keeps current-account jobs and removes only other owners', async () => {
  pending.set(`${REMINDER_PREFIX}meal.a`, { identifier: `${REMINDER_PREFIX}meal.a`, content: { data: { userId: 'one', kind: 'meal' } }, trigger: null });
  pending.set(`${REMINDER_PREFIX}meal.b`, { identifier: `${REMINDER_PREFIX}meal.b`, content: { data: { userId: 'two', kind: 'meal' } }, trigger: null });
  pending.set('launch-announcement', { identifier: 'launch-announcement', content: {}, trigger: null });
  sdk.getPresentedNotificationsAsync.mockResolvedValue([
    { request: { identifier: `${REMINDER_PREFIX}shown.a`, content: { data: { userId: 'one' } } } },
    { request: { identifier: `${REMINDER_PREFIX}shown.b`, content: { data: { userId: 'two' } } } },
    { request: { identifier: 'launch-announcement', content: { data: {} } } },
  ] as Notifications.Notification[]);
  await reconcileReminderOwnership('one');
  expect([...pending.keys()].sort()).toEqual([`${REMINDER_PREFIX}meal.a`, 'launch-announcement'].sort());
  expect(sdk.cancelScheduledNotificationAsync).toHaveBeenCalledWith(`${REMINDER_PREFIX}meal.b`);
  expect(sdk.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith(`${REMINDER_PREFIX}meal.a`);
  expect(sdk.dismissNotificationAsync.mock.calls).toEqual([[`${REMINDER_PREFIX}shown.b`]]);
});

test('an obsolete account query cannot cancel the new account jobs', async () => {
  const newJob = `${REMINDER_PREFIX}meal.two`;
  pending.set(newJob, { identifier: newJob, content: { data: { userId: 'two', kind: 'meal' } }, trigger: null });
  let started!: () => void;
  let release!: () => void;
  const queried = new Promise<void>(resolve => { started = resolve; });
  sdk.getAllScheduledNotificationsAsync.mockImplementationOnce(async () => {
    started();
    await new Promise<void>(resolve => { release = resolve; });
    return [...pending.values()] as Notifications.NotificationRequest[];
  });
  const prior = reconcileReminderOwnership('one');
  await queried;
  const current = reconcileReminderOwnership('two');
  release();
  await Promise.all([prior, current]);
  expect(pending.has(newJob)).toBe(true);
  expect(sdk.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith(newJob);
});

test('an obsolete replacement query cannot cancel the new account jobs', async () => {
  const newJob = `${REMINDER_PREFIX}meal.two`;
  pending.set(newJob, { identifier: newJob, content: { data: { userId: 'two', kind: 'meal' } }, trigger: null });
  let started!: () => void;
  let release!: () => void;
  const queried = new Promise<void>(resolve => { started = resolve; });
  sdk.getAllScheduledNotificationsAsync.mockImplementationOnce(async () => {
    started();
    await new Promise<void>(resolve => { release = resolve; });
    return [...pending.values()] as Notifications.NotificationRequest[];
  });
  const prior = replaceReminders('one', plan());
  await queried;
  const current = reconcileReminderOwnership('two');
  release();
  await Promise.all([prior, current]);
  expect(pending.has(newJob)).toBe(true);
  expect(sdk.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith(newJob);
});
