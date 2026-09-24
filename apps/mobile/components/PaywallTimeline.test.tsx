jest.unmock('react-native');
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture() {}, identify() {} }));
});
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PaywallView } from './PaywallView';
import { PaywallTimeline } from './PaywallTimeline';
import { purchaseTerms } from '../lib/purchaseTerms';

const product = { priceString: '$59.99', subscriptionPeriod: 'P1Y',
  introPrice: { price: 0, priceString: '$0.00', period: 'P1W', periodUnit: 'WEEK', periodNumberOfUnits: 1, cycles: 1 } };
const annual = purchaseTerms(product, true);
const monthly = purchaseTerms({ ...product, priceString: '$9.99', subscriptionPeriod: 'P1M', introPrice: null }, false);
function props() { return { annual, monthly, plan: 'yearly' as const, discovery: {}, loading: false, restoring: false, checkingPlans: false,
  onSelect: jest.fn(), onRestore: jest.fn(), onRetry: jest.fn(), onPurchase: jest.fn(), onDecline: jest.fn() }; }

test('timeline derives trial end and reminder day from the selected store offer', () => {
  const screen = render(<PaywallTimeline terms={annual} />);
  expect(screen.getByText('Optional reminder around day 5')).toBeTruthy();
  expect(screen.getByText('Day 7: payment')).toBeTruthy();
  expect(screen.getByText('Requires permission and a confirmed trial end date.')).toBeTruthy();
  screen.rerender(<PaywallTimeline terms={purchaseTerms({ ...product, introPrice: { ...product.introPrice, period: 'P2W' } }, true)} />);
  expect(screen.getByText('Optional reminder around day 12')).toBeTruthy();
  expect(screen.getByText('Day 14: payment')).toBeTruthy();
});

test('ineligible and unknown offers never promise a free trial or notification', () => {
  const screen = render(<PaywallTimeline terms={purchaseTerms(product, false)} />);
  expect(screen.getByText('$59.99 charged when you confirm your purchase.')).toBeTruthy();
  expect(screen.queryByText(/Reminder around|Reminder, if available/)).toBeNull();
  screen.rerender(<PaywallTimeline terms={purchaseTerms(product)} />);
  expect(screen.getByText(/store will confirm any eligible introductory offer/)).toBeTruthy();
  expect(screen.queryByText(/charged when you confirm/)).toBeNull();
});

test('calendar trials are not converted to invented day counts', () => {
  const screen = render(<PaywallTimeline terms={purchaseTerms({ ...product, introPrice: { ...product.introPrice, period: 'P1M' } }, true)} />);
  expect(screen.getByText('After 1 month: payment')).toBeTruthy();
  expect(screen.queryByText(/Day 30/)).toBeNull();
});

test('plan selection, purchase, restore and decline remain operable with live totals', () => {
  const p = props();
  const screen = render(<PaywallView {...p} />);
  expect(screen.getByText('Start your 7-day free trial.')).toBeTruthy();
  expect(screen.getByTestId('paywall-price-yearly').props.children).toBe('$59.99');
  fireEvent.press(screen.getByTestId('paywall-plan-monthly'));
  expect(p.onSelect).toHaveBeenCalledWith('monthly');
  fireEvent.press(screen.getByTestId('welcome-continue'));
  expect(p.onPurchase).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('paywall-restore'));
  expect(p.onRestore).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('welcome-skip'));
  expect(p.onDecline).toHaveBeenCalledTimes(1);
  screen.rerender(<PaywallView {...p} plan="monthly" />);
  expect(screen.queryByTestId('paywall-no-payment')).toBeNull();
  expect(screen.getByText('$9.99 charged when you confirm your purchase.')).toBeTruthy();
});

test('unavailable pricing disables purchases and provides retry without inventing terms', () => {
  const p = { ...props(), annual: null, monthly: null };
  const screen = render(<PaywallView {...p} />);
  fireEvent.press(screen.getByTestId('welcome-continue'));
  expect(p.onPurchase).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('paywall-retry-pricing'));
  expect(p.onRetry).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('paywall-no-payment')).toBeNull();
});
