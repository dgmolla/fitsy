import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { DEFAULT_REMINDER_PREFERENCES, REMINDER_PREFIX, type PlannedReminder, type ReminderPreferences } from './notificationPlan';

export const REMINDER_CHANNEL = 'fitsy-meal-and-trial-reminders';
const preferenceKey = (userId: string) => `@fitsy/reminder-preferences/${userId}`;
const listeners = new Set<() => void>();
export const subscribeReminderPreferences = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export async function readReminderPreferences(userId: string | null): Promise<ReminderPreferences> {
  if (!userId) return { ...DEFAULT_REMINDER_PREFERENCES };
  try {
    const value = JSON.parse(await AsyncStorage.getItem(preferenceKey(userId)) ?? '{}');
    return { meals: value?.meals === true, trial: value?.trial === true };
  } catch { return { ...DEFAULT_REMINDER_PREFERENCES }; }
}
export async function saveReminderPreferences(userId: string, preferences: ReminderPreferences): Promise<void> {
  await AsyncStorage.setItem(preferenceKey(userId), JSON.stringify(preferences));
  for (const listener of listeners) listener();
}
export async function prepareReminderChannel(): Promise<void> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: 'Meal and trial reminders', importance: Notifications.AndroidImportance.DEFAULT,
    description: 'Optional meal-planning nudges and trial renewal reminders',
  });
}

let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
/** Serialize replacement, so a late schedule cannot survive a later opt-out or
 * account change. Cancel only this feature's requests; other push flows survive. */
export function replaceReminders(userId: string | null, reminders: PlannedReminder[]): Promise<void> {
  const revision = ++generation;
  const work = queue.catch(() => undefined).then(async () => {
    if (Platform.OS === 'web' || revision !== generation) return;
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const request of pending) {
      if (request.identifier.startsWith(REMINDER_PREFIX)) await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const notification of shown) {
      const request = notification.request;
      if (request.identifier.startsWith(REMINDER_PREFIX) &&
        (!userId || request.content.data?.userId !== userId || !reminders.some(r => r.kind === request.content.data?.kind))) {
        await Notifications.dismissNotificationAsync(request.identifier);
      }
    }
    if (!userId || !reminders.length || revision !== generation) return;
    if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;
    await prepareReminderChannel();
    for (const reminder of reminders) {
      if (revision !== generation) return;
      if (reminder.date.getTime() <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.identifier,
        content: { title: reminder.title, body: reminder.body, sound: 'default', data: { kind: reminder.kind, userId, scheduledFor: reminder.date.toISOString() } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.date, channelId: REMINDER_CHANNEL },
      });
    }
  });
  queue = work;
  return work;
}

export async function readScheduledReminders(userId: string | null) {
  if (!userId || Platform.OS === 'web') return [];
  return (await Notifications.getAllScheduledNotificationsAsync()).flatMap(request => {
    const data = request.content.data;
    if (!request.identifier.startsWith(REMINDER_PREFIX) || data?.userId !== userId ||
      !['meal', 'trial'].includes(String(data.kind)) || typeof data.scheduledFor !== 'string' || !Number.isFinite(Date.parse(data.scheduledFor))) return [];
    return [{ kind: String(data.kind), date: data.scheduledFor }];
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** Notification content never supplies an arbitrary URL to the router. */
export function reminderDestination(data: Record<string, unknown>, userId: string | null) {
  if (!userId || data.userId !== userId) return null;
  if (data.kind === 'meal') return '/(tabs)/search' as const;
  if (data.kind === 'trial') return '/notification-settings' as const;
  return null;
}
