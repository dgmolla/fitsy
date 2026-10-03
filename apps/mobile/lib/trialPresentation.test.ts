import { purchaseTerms } from './purchaseTerms';
import { defaultTrialPlan, trialPresentation } from './trialPresentation';
import { planReminders, trialReminderDate } from './notificationPlan';

const start = new Date(2026, 8, 7, 12);
const product = { priceString: '$39.99', subscriptionPeriod: 'P1Y',
  introPrice: { price: 0, priceString: '$0', period: 'P1W', periodUnit: 'WEEK' as const, periodNumberOfUnits: 1, cycles: 1 } };

test.each([
  [7, 'P1W', 'Day 7: first charge', 5, true],
  [14, 'P2W', 'Day 14: first charge', 12, false],
  [21, 'P3W', 'Day 21: first charge', 19, true],
] as const)('%i-day selected offer controls copy and expiry-relative reminder', (days, period, chargeTitle, reminderDay, mismatch) => {
  const terms = purchaseTerms({ ...product, introPrice: { ...product.introPrice, period } }, true);
  const shown = trialPresentation(terms, start);
  expect(shown).toMatchObject({ trial: `${days} days`, days, chargeTitle, reminderAvailable: true, reminderDay });
  expect(!!shown.catalogMismatch).toBe(mismatch);
  expect(shown.projectedChargeDate).toEqual(new Date(start.getTime() + days * 86_400_000));

  const expiry = new Date(start.getTime() + days * 86_400_000);
  const scheduled = planReminders({ now: start, userId: 'buyer', entitled: true,
    preferences: { meals: false, trial: true }, subscription: { isActive: true, periodType: 'TRIAL', willRenew: true,
      latestPurchaseDate: start.toISOString(), expirationDate: expiry.toISOString() } });
  expect(scheduled).toHaveLength(1);
  expect(scheduled[0].date).toEqual(trialReminderDate(expiry));
});

test('ineligible selected offer has no trial or reminder even if another product is eligible', () => {
  const annual = purchaseTerms(product, false);
  const monthly = purchaseTerms({ ...product, priceString: '$7.99', subscriptionPeriod: 'P1M' }, true);
  expect(defaultTrialPlan(annual, monthly)).toBe('monthly');
  const paid = trialPresentation(annual, start);
  expect(paid).toMatchObject({ trial: null, reminderAvailable: false, reminderDay: null, catalogMismatch: null });
  expect(paid.projectedChargeDate).toBeNull();
});

test('selected short offer cannot borrow reminder eligibility from another plan', () => {
  const short = purchaseTerms({ ...product, introPrice: { ...product.introPrice, period: 'P2D' } }, true);
  const long = purchaseTerms(product, true);
  expect(defaultTrialPlan(short, long)).toBe('monthly');
  expect(trialPresentation(short).reminderAvailable).toBe(false);
  expect(trialPresentation(long).reminderAvailable).toBe(true);
});

test('calendar-month trial reports a catalog mismatch without inventing a day count', () => {
  const terms = purchaseTerms({ ...product, introPrice: { ...product.introPrice, period: 'P1M' } }, true);
  expect(trialPresentation(terms, start)).toMatchObject({
    trial: '1 month', days: null, catalogMismatch: expect.stringContaining('1 month'),
  });
});
