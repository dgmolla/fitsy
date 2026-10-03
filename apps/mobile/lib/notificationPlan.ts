import type { PurchasesEntitlementInfo } from 'react-native-purchases';
import { TRIAL_CATALOG_POLICY, trialReminderDate } from '../../../packages/shared/src/contracts/trialPolicy';
export { trialReminderDate } from '../../../packages/shared/src/contracts/trialPolicy';
import { trialPresentation, type Terms } from './trialPresentation';

export interface ReminderPreferences { meals: boolean; trial: boolean }
export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = { meals: false, trial: false };
export const REMINDER_PREFIX = 'fitsy.reminder.';
export type ReminderKind = 'meal' | 'trial';
export interface PlannedReminder {
  identifier: string;
  kind: ReminderKind;
  date: Date;
  title: string;
  body: string;
}
type Subscription = Pick<PurchasesEntitlementInfo, 'isActive' | 'periodType' | 'willRenew' | 'expirationDate' | 'latestPurchaseDate'>;
// Six hours of margin beyond the store's cancellation deadline.
export const TRIAL_REMINDER_LEAD_HOURS = TRIAL_CATALOG_POLICY.reminderLeadHours;
/** Very short offers cannot support a useful reminder before cancellation. */
export function canOfferTrialReminder(terms: Terms): boolean {
  return trialPresentation(terms).reminderAvailable;
}
const HOUR = 3_600_000;
const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Calendar dates keep meal times local across DST. No recurring native jobs:
 * the next foreground session reconciles meal dates for the next two weeks
 * and the one-off reminder for a verified trial renewal. */
export function planReminders({ now, userId, entitled, preferences, subscription }: {
  now: Date; userId: string | null; entitled: boolean;
  preferences: ReminderPreferences; subscription?: Subscription | null;
}): PlannedReminder[] {
  if (!userId || !entitled || subscription?.isActive === false || !Number.isFinite(now.getTime())) return [];
  const reminders: PlannedReminder[] = [];
  const expiration = Date.parse(subscription?.expirationDate ?? '');
  const trialStart = Date.parse(subscription?.latestPurchaseDate ?? '');
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 14);
  // Do not schedule beyond the subscription period we can currently verify.
  const until = Number.isFinite(expiration) ? Math.min(horizon.getTime(), expiration) : horizon.getTime();

  if (preferences.trial && subscription?.isActive && subscription.periodType === 'TRIAL' && subscription.willRenew &&
    Number.isFinite(expiration) && Number.isFinite(trialStart) &&
    expiration - trialStart > (TRIAL_CATALOG_POLICY.reminderLeadHours + TRIAL_CATALOG_POLICY.cancellationLeadHours) * HOUR) {
    const date = trialReminderDate(new Date(expiration));
    if (date.getTime() > now.getTime() && date.getTime() <= expiration - TRIAL_CATALOG_POLICY.cancellationLeadHours * HOUR) {
      reminders.push({ identifier: `${REMINDER_PREFIX}trial.${expiration}`, kind: 'trial', date,
        title: 'Review your Fitsy trial',
        body: 'Check your trial end date and renewal status in subscription settings. Cancel at least 24 hours before renewal if you do not want to continue.' });
    }
  }

  if (preferences.meals) {
    for (let day = 0; day < 14; day++) {
      const date = new Date(now);
      date.setDate(date.getDate() + day); date.setHours(11, 30, 0, 0);
      if (![2, 5].includes(date.getDay()) || date.getTime() <= now.getTime() || date.getTime() >= until) continue;
      if (reminders.some(r => localDay(r.date) === localDay(date))) continue;
      reminders.push({ identifier: `${REMINDER_PREFIX}meal.${localDay(date)}`, kind: 'meal', date,
        title: 'Eating out today?', body: 'Find a nearby meal that fits your macros and your appetite.' });
    }
  }
  return reminders.sort((a, b) => a.date.getTime() - b.date.getTime());
}
