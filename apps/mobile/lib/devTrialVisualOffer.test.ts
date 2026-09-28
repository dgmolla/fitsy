import type { PurchasesOffering } from 'react-native-purchases';
import { devTrialVisualOffer } from './devTrialVisualOffer';
import { purchaseTerms } from './purchaseTerms';

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
  expect(purchaseTerms(visual?.offering.annual?.product, visual?.eligibility.annual)).toMatchObject({ trial: '7 days', price: '€54,99' });
  expect(purchaseTerms(visual?.offering.monthly?.product, visual?.eligibility.monthly)).toMatchObject({ trial: '7 days', price: '€7,99' });
  expect(visual?.offering.availablePackages[0]).toBe(visual?.offering.annual);
  expect(visual?.offering.availablePackages[1]).toBe(visual?.offering.monthly);
  expect(offering.annual?.product.introPrice).toBeNull();
});

test('visual eligibility is unavailable outside development or without a live offer', () => {
  expect(devTrialVisualOffer(offering, true, false)).toBeNull();
  expect(devTrialVisualOffer(offering, false, true)).toBeNull();
  expect(devTrialVisualOffer(null, true, true)).toBeNull();
});
