import type { PurchasesOffering } from 'react-native-purchases';
import { devTrialVisualOffer, devTrialVisualScenario } from './devTrialVisualOffer';
import { purchaseTerms } from './purchaseTerms';
import { defaultTrialPlan, trialPresentation } from './trialPresentation';

beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date(2026, 8, 7, 12)); });
afterEach(() => { jest.useRealTimers(); });

const offering = {
  annual: { identifier: '$rc_annual', product: { identifier: 'annual', priceString: '€54,99', subscriptionPeriod: 'P1Y', introPrice: null } },
  monthly: { identifier: '$rc_monthly', product: { identifier: 'monthly', priceString: '€7,99', subscriptionPeriod: 'P1M', introPrice: null } },
  availablePackages: [
    { identifier: '$rc_annual', product: { identifier: 'annual', priceString: '€54,99', subscriptionPeriod: 'P1Y', introPrice: null } },
    { identifier: '$rc_monthly', product: { identifier: 'monthly', priceString: '€7,99', subscriptionPeriod: 'P1M', introPrice: null } },
  ],
} as unknown as PurchasesOffering;

test('development visual offer keeps live prices while clearly synthesizing eligibility', () => {
  const visual = devTrialVisualOffer(offering, true, true);
  expect(visual).not.toBeNull();
  expect(purchaseTerms(visual?.offering.annual?.product, visual?.eligibility.annual)).toMatchObject({ trial: '14 days', price: '€54,99' });
  expect(purchaseTerms(visual?.offering.monthly?.product, visual?.eligibility.monthly)).toMatchObject({ trial: '14 days', price: '€7,99' });
  expect(visual?.offering.availablePackages[0]).toBe(visual?.offering.annual);
  expect(visual?.offering.availablePackages[1]).toBe(visual?.offering.monthly);
  expect(offering.annual?.product.introPrice).toBeNull();
});

test('visual eligibility is unavailable outside development or without a live offer', () => {
  expect(devTrialVisualOffer(offering, true, false)).toBeNull();
  expect(devTrialVisualOffer(offering, false, true)).toBeNull();
  expect(devTrialVisualOffer(null, true, true)).toBeNull();
});

test('14-day visual offer is synthetic and keeps each real plan price', () => {
  const visual = devTrialVisualOffer(offering, true, true, 14);
  expect(purchaseTerms(visual?.offering.annual?.product, visual?.eligibility.annual)).toMatchObject({ trial: '14 days', price: '€54,99' });
  expect(purchaseTerms(visual?.offering.monthly?.product, visual?.eligibility.monthly)).toMatchObject({ trial: '14 days', price: '€7,99' });
});

test.each([
  ['annual-short', 2, 7, 'monthly'],
  ['monthly-short', 7, 2, 'yearly'],
] as const)('%s visual catalog preserves prices and aligns the schedulable default', (scenario, annualDays, monthlyDays, expectedPlan) => {
  const visual = devTrialVisualOffer(offering, true, true, scenario)!;
  const annual = purchaseTerms(visual.offering.annual?.product, visual.eligibility.annual);
  const monthly = purchaseTerms(visual.offering.monthly?.product, visual.eligibility.monthly);
  expect(annual).toMatchObject({ trial: `${annualDays} days`, price: '€54,99', period: '1 year' });
  expect(monthly).toMatchObject({ trial: `${monthlyDays} days`, price: '€7,99', period: '1 month' });
  expect(defaultTrialPlan(annual, monthly)).toBe(expectedPlan);
  expect(trialPresentation(annual).reminderAvailable).toBe(annualDays === 7);
  expect(trialPresentation(monthly).reminderAvailable).toBe(monthlyDays === 7);
  expect(visual.label).toBe(`${annualDays}-day annual and ${monthlyDays}-day monthly trials`);
  expect(visual.offering.availablePackages).toEqual([visual.offering.annual, visual.offering.monthly]);
  expect(offering.annual?.product.introPrice).toBeNull();
  expect(offering.monthly?.product.introPrice).toBeNull();
  expect(devTrialVisualOffer(offering, true, false, scenario)).toBeNull();
});

test.each([
  ['1', 14], ['7', 7], ['14', 14], ['annual-short', 'annual-short'], ['monthly-short', 'monthly-short'],
  [undefined, null], ['unknown', null],
] as const)('visual parameter %s resolves consistently across screens', (parameter, expected) => {
  expect(devTrialVisualScenario(parameter, true)).toBe(expected);
  expect(devTrialVisualScenario(parameter, false)).toBeNull();
});
