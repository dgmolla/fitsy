import * as Notifications from 'expo-notifications';
import { planReminders, trialReminderDate } from './notificationPlan';
import { replaceReminders } from './notificationSchedule';

// Device-only acceptance probe. It never changes the purchase, entitlement,
// account, or stored reminder preferences used by the real provider.
function requireDevelopment(userId: string | null): asserts userId is string {
  if (!__DEV__ || !userId) throw new Error('Development sign-in required');
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
  const due = nextAllowedTime(now);
  const expiration = new Date(due.getTime() + 30 * 3_600_000);
  const trialStart = new Date(expiration.getTime() - 7 * 24 * 3_600_000);
  const plan = planReminders({
    now, userId, entitled: true, preferences: { meals: false, trial: true },
    subscription: { isActive: true, periodType: 'TRIAL', willRenew: true,
      latestPurchaseDate: trialStart.toISOString(), expirationDate: expiration.toISOString() },
  });
  if (plan.length !== 1 || plan[0].date.getTime() !== trialReminderDate(expiration).getTime()) {
    throw new Error('Controlled trial did not produce exactly one valid reminder');
  }
  await replaceReminders(userId, plan);
  return readDevTrialReminder(userId, plan[0].identifier);
}

export async function clearDevTrialReminder(userId: string | null) {
  requireDevelopment(userId);
  await replaceReminders(userId, []);
  return readDevTrialReminder(userId);
}

async function readDevTrialReminder(userId: string, identifier?: string) {
  const requests = (await Notifications.getAllScheduledNotificationsAsync()).filter(request =>
    request.identifier.startsWith('fitsy.reminder.') && request.content.data?.userId === userId);
  const trial = requests.filter(request => request.content.data?.kind === 'trial');
  const match = identifier ? trial.find(request => request.identifier === identifier) : undefined;
  return { count: requests.length, identifier: match?.identifier ?? null,
    scheduledFor: typeof match?.content.data?.scheduledFor === 'string' ? match.content.data.scheduledFor : null };
}
