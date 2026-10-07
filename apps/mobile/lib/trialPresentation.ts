import { trialCatalogMismatch, schedulableTrialReminder } from '../../../packages/shared/src/contracts/trialPolicy';
import type { purchaseTerms } from './purchaseTerms';

export type PlanId = 'monthly' | 'yearly';
export type Terms = ReturnType<typeof purchaseTerms>;

/** Project the selected store period without treating calendar months as fixed days. */
export function projectedChargeDate(terms: Terms, now: Date): Date | null {
  const match = /^P([1-9]\d*)([DWMY])$/.exec(terms?.trialPeriod ?? '');
  if (!terms?.trial || !match || !terms.trialCycles || !Number.isInteger(terms.trialCycles)) return null;
  const count = Number(match[1]) * terms.trialCycles;
  const date = new Date(now);
  if (match[2] === 'D') date.setDate(date.getDate() + count);
  if (match[2] === 'W') date.setDate(date.getDate() + count * 7);
  if (match[2] === 'M' || match[2] === 'Y') {
    const day = date.getDate();
    date.setDate(1);
    if (match[2] === 'M') date.setMonth(date.getMonth() + count);
    else date.setFullYear(date.getFullYear() + count);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  }
  return Number.isFinite(date.getTime()) ? date : null;
}

export function elapsedCalendarDays(now: Date, date: Date): number {
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.max(0, Math.round((day(date) - day(now)) / 86_400_000));
}

/** The same initial selection is shown throughout onboarding and at checkout. */
export function defaultTrialPlan(annual: Terms, monthly: Terms): PlanId {
  if (monthly?.trial && (!annual?.trial ||
    (!trialPresentation(annual).reminderAvailable && trialPresentation(monthly).reminderAvailable))) return 'monthly';
  return annual ? 'yearly' : 'monthly';
}

export function trialPresentation(terms: Terms, now = new Date()) {
  const trial = terms?.trial ?? null;
  const days = terms?.trialDays ?? null;
  const chargeDate = projectedChargeDate(terms, now);
  const reminderDate = chargeDate ? schedulableTrialReminder(chargeDate, now, now) : null;
  const reminderAvailable = !!trial && !!reminderDate;
  const reminderDay = reminderDate ? elapsedCalendarDays(now, reminderDate) : null;
  return {
    terms, trial, days, reminderAvailable, reminderDay, reminderDate, projectedChargeDate: chargeDate,
    chargeTitle: trial ? days !== null ? `Day ${days}: first charge` : `After ${trial}: first charge` : 'Your first payment',
    catalogMismatch: trial ? trialCatalogMismatch(days ?? trial) : null,
  };
}
