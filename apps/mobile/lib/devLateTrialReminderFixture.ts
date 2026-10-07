import { TRIAL_CATALOG_POLICY, trialReminderDate } from '../../../packages/shared/src/contracts/trialPolicy';

/** Controlled dates for a visual probe; never a customer entitlement. */
export function devLateTrialReminderFixture(anchor = new Date()) {
  const nominal = new Date(anchor); nominal.setDate(nominal.getDate() + 1); nominal.setHours(8, 0, 0, 0);
  // Add elapsed hours to the nominal target, rather than calendar days to now:
  // DST can otherwise turn an early-morning target into a daytime target.
  const expiration = new Date(nominal.getTime() + TRIAL_CATALOG_POLICY.reminderLeadHours * 3_600_000);
  const adjusted = trialReminderDate(expiration);
  const now = new Date(adjusted.getTime() + (nominal.getTime() - adjusted.getTime()) / 2);
  const start = new Date(expiration.getTime() - TRIAL_CATALOG_POLICY.desiredDays * 86_400_000);
  return { now, trial: { isActive: true, periodType: 'TRIAL', willRenew: true,
    latestPurchaseDate: start.toISOString(), expirationDate: expiration.toISOString() } };
}
