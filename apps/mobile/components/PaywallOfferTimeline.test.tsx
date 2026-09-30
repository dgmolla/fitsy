jest.unmock('react-native');
import React from 'react';
import { render } from '@testing-library/react-native';
import { PaywallOfferTimeline, projectedChargeDate } from './PaywallOfferTimeline';
import { purchaseTerms } from '../lib/purchaseTerms';

const annual = { priceString: '$79.99', subscriptionPeriod: 'P1Y', introPrice: { price: 0, priceString: '$0', period: 'P2W', periodUnit: 'WEEK', periodNumberOfUnits: 2, cycles: 1 } };

test('selected eligible store offer drives trial duration and projected date', () => {
  const terms = purchaseTerms(annual, true);
  expect(projectedChargeDate(terms, new Date(2026, 8, 30))?.toDateString()).toBe(new Date(2026, 9, 14).toDateString());
  const view = render(<PaywallOfferTimeline terms={terms} now={new Date(2026, 8, 30)} />);
  expect(view.getByText('After 14 days')).toBeTruthy();
  expect(view.getByText(/first \$79.99 charge is October 14, 2026/)).toBeTruthy();
  expect(view.queryByText(/reminder/i)).toBeNull();
});

test('ineligible offer shows paid first charge without trial promise', () => {
  const terms = purchaseTerms(annual, false);
  expect(projectedChargeDate(terms, new Date(2026, 8, 30))).toBeNull();
  const view = render(<PaywallOfferTimeline terms={terms} now={new Date(2026, 8, 30)} />);
  expect(view.getByText('Your Fitsy plan')).toBeTruthy();
  expect(view.queryByText(/trial/i)).toBeNull();
  expect(view.getByText(/\$79.99 is charged/)).toBeTruthy();
});
