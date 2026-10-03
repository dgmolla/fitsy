/** Desired App Store catalog contract. Store offers and customer eligibility remain authoritative. */
export const TRIAL_CATALOG_POLICY = {
  productIds: ['com.fitsy.mobile.monthly', 'com.fitsy.mobile.yearly'],
  desiredDays: 14,
  reminderLeadHours: 48,
  cancellationLeadHours: 24,
} as const;

export function trialReminderLeadLabel(): string {
  const hours = Number(TRIAL_CATALOG_POLICY.reminderLeadHours);
  const days = hours / 24;
  return hours % 24 === 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : `${hours} hours`;
}

/** Move a reminder into the preceding evening when its target is in quiet hours. */
export function trialReminderDate(expiration: Date): Date {
  const date = new Date(expiration.getTime() - TRIAL_CATALOG_POLICY.reminderLeadHours * 3_600_000);
  if (date.getHours() >= 20) date.setHours(19, 0, 0, 0);
  else if (date.getHours() < 9) { date.setDate(date.getDate() - 1); date.setHours(19, 0, 0, 0); }
  return date;
}

/** A confirmed trial can receive one reminder only while its target is still useful. */
export function schedulableTrialReminder(expiration: Date, now: Date, trialStart: Date): Date | null {
  if (![expiration, now, trialStart].every(value => Number.isFinite(value.getTime())) ||
    expiration <= trialStart) return null;
  const date = trialReminderDate(expiration);
  return date > now && date > trialStart &&
    date <= new Date(expiration.getTime() - TRIAL_CATALOG_POLICY.cancellationLeadHours * 3_600_000)
    ? date : null;
}

export function trialCatalogMismatch(actualDays: number | string): string | null {
  return actualDays === TRIAL_CATALOG_POLICY.desiredDays ? null
    : `Introductory offer is ${typeof actualDays === 'number' ? `${actualDays} days` : actualDays}; desired catalog policy is ${TRIAL_CATALOG_POLICY.desiredDays} days`;
}
