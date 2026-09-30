/** Desired App Store catalog contract. Store offers and customer eligibility remain authoritative. */
export const TRIAL_CATALOG_POLICY = {
  productIds: ['com.fitsy.mobile.monthly', 'com.fitsy.mobile.yearly'],
  desiredDays: 14,
  reminderLeadHours: 30,
  cancellationLeadHours: 24,
} as const;

export function trialCatalogMismatch(actualDays: number): string | null {
  return actualDays === TRIAL_CATALOG_POLICY.desiredDays ? null
    : `Introductory offer is ${actualDays} days; desired catalog policy is ${TRIAL_CATALOG_POLICY.desiredDays} days`;
}
