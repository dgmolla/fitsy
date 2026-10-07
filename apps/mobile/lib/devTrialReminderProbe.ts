import * as Notifications from 'expo-notifications';
import { planReminders, trialReminderDate, TRIAL_REMINDER_LEAD_HOURS } from './notificationPlan';
import { TRIAL_CATALOG_POLICY } from '../../../packages/shared/src/contracts/trialPolicy';
import { prepareReminderChannel, scheduleNativeReminder } from './notificationSchedule';
import { explainMissedTrialReminder, missedTrialReminderWindow } from './trialReminderFeedback';
import { devLateTrialReminderFixture } from './devLateTrialReminderFixture';

const DEV_PREFIX = 'fitsy.dev-trial-reminder.';
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
function enqueue<T>(work: (revision: number) => Promise<T>): Promise<T> {
  const revision = ++generation;
  const result = queue.catch(() => undefined).then(() => work(revision));
  queue = result;
  return result;
}

// Device-only acceptance probe. It never changes the purchase, entitlement,
// account, or stored reminder preferences used by the real provider.
function requireDevelopment(userId: string | null): asserts userId is string {
  if (!__DEV__ || !userId) throw new Error('Development sign-in required');
}

/** Actual production alert with controlled dates; no entitlement or preference writes. */
export function showDevMissedTrialReminder(userId: string | null, anchor = new Date()) {
  requireDevelopment(userId);
  const { trial, now } = devLateTrialReminderFixture(anchor);
  if (!missedTrialReminderWindow(trial, now.getTime())) throw new Error('Controlled late opt-in did not miss its adjusted target');
  explainMissedTrialReminder();
}

function nextAllowedTime(now: Date): Date {
  const target = new Date(now.getTime() + 5 * 60_000);
  if (target.getHours() < 9) target.setHours(9, 5, 0, 0);
  else if (target.getHours() >= 19) {
    target.setDate(target.getDate() + 1);
    target.setHours(9, 5, 0, 0);
  }
  return target;
}

export async function scheduleDevTrialReminder(userId: string | null, now = new Date()) {
  requireDevelopment(userId);
  return enqueue(async revision => {
    const due = nextAllowedTime(now);
    const expiration = new Date(due.getTime() + TRIAL_REMINDER_LEAD_HOURS * 3_600_000);
    const trialStart = new Date(expiration.getTime() - TRIAL_CATALOG_POLICY.desiredDays * 24 * 3_600_000);
    const plan = planReminders({
      now, userId, entitled: true, preferences: { meals: false, trial: true },
      subscription: { isActive: true, periodType: 'TRIAL', willRenew: true,
        latestPurchaseDate: trialStart.toISOString(), expirationDate: expiration.toISOString() },
    });
    if (plan.length !== 1 || plan[0].date.getTime() !== trialReminderDate(expiration).getTime()) {
      throw new Error('Controlled trial did not produce exactly one valid reminder');
    }
    await clearProbeRequests(() => true);
    if (revision !== generation || (await Notifications.getPermissionsAsync()).status !== 'granted') return readDevTrialReminder(userId);
    await prepareReminderChannel();
    if (revision !== generation) return readDevTrialReminder(userId);
    const fixture = { ...plan[0], identifier: `${DEV_PREFIX}${expiration.getTime()}` };
    await scheduleNativeReminder(userId, fixture);
    return readDevTrialReminder(userId, fixture.identifier);
  });
}

async function clearProbeRequests(remove: (owner: unknown) => boolean) {
  for (const request of await Notifications.getAllScheduledNotificationsAsync()) {
    if (request.identifier.startsWith(DEV_PREFIX) && remove(request.content.data?.userId)) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }
}

export async function clearDevTrialReminder(userId: string | null) {
  requireDevelopment(userId);
  return enqueue(async () => { await clearProbeRequests(owner => owner === userId); return readDevTrialReminder(userId); });
}

/** Account changes also remove test-only requests from the former account. */
export function reconcileDevTrialReminderOwnership(userId: string | null) {
  if (!__DEV__) return Promise.resolve();
  return enqueue(async () => { await clearProbeRequests(owner => !userId || owner !== userId); });
}

async function readDevTrialReminder(userId: string, identifier?: string) {
  const requests = (await Notifications.getAllScheduledNotificationsAsync()).filter(request =>
    request.identifier.startsWith(DEV_PREFIX) && request.content.data?.userId === userId);
  const trial = requests.filter(request => request.content.data?.kind === 'trial');
  const match = identifier ? trial.find(request => request.identifier === identifier) : undefined;
  return { count: requests.length, identifier: match?.identifier ?? null,
    scheduledFor: typeof match?.content.data?.scheduledFor === 'string' ? match.content.data.scheduledFor : null };
}
