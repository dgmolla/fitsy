import { TRIAL_CATALOG_POLICY, trialCatalogMismatch } from '../../../packages/shared/src/contracts/trialPolicy';
import type { purchaseTerms } from './purchaseTerms';

export type PlanId = 'monthly' | 'yearly';
export type Terms = ReturnType<typeof purchaseTerms>;

/** The same initial selection is shown throughout onboarding and at checkout. */
export function defaultTrialPlan(annual: Terms, monthly: Terms): PlanId {
  if (monthly?.trial && (!annual?.trial ||
    (!trialPresentation(annual).reminderAvailable && trialPresentation(monthly).reminderAvailable))) return 'monthly';
  return annual ? 'yearly' : 'monthly';
}

export function trialPresentation(terms: Terms, now = new Date()) {
  const trial = terms?.trial ?? null;
  const days = terms?.trialDays ?? null;
  const reminderAvailable = !!trial && (days === null || days * 24 > TRIAL_CATALOG_POLICY.reminderLeadHours + TRIAL_CATALOG_POLICY.cancellationLeadHours);
  const reminderDay = reminderAvailable && days !== null
    ? Math.floor((days * 24 - TRIAL_CATALOG_POLICY.reminderLeadHours) / 24) + 1 : null;
  const projectedChargeDate = days !== null && Number.isFinite(now.getTime())
    ? new Date(now.getTime() + days * 24 * 3_600_000) : null;
  return {
    terms, trial, days, reminderAvailable, reminderDay, projectedChargeDate,
    chargeTitle: trial ? days !== null ? `Day ${days}: first charge` : `After ${trial}: first charge` : 'Your first payment',
    catalogMismatch: days !== null ? trialCatalogMismatch(days) : null,
  };
}
