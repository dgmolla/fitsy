jest.unmock('react-native');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { PAYWALL_BENEFITS, PaywallOfferTimeline, projectedChargeDate } from './PaywallOfferTimeline';
import { purchaseTerms } from '../lib/purchaseTerms';
import { planReminders, trialReminderDate } from '../lib/notificationPlan';

const now = new Date(2026, 8, 30, 12);
const product = (period: string, priceString: string, subscriptionPeriod = 'P1Y') =>
  ({ priceString, subscriptionPeriod, introPrice: { price: 0, priceString: '$0', period, periodUnit: period.endsWith('W') ? 'WEEK' : 'DAY', periodNumberOfUnits: Number(period.slice(1, -1)), cycles: 1 } });

test.each([
  ['P2W', '$79.99', 'P1Y', 14],
  ['P1W', '$9.99', 'P1M', 7],
])('selected %s offer drives all three steps and actual reminder policy', (trialPeriod, price, billingPeriod, days) => {
  const terms = purchaseTerms(product(trialPeriod, price, billingPeriod), true);
  const charge = projectedChargeDate(terms, now)!;
  const reminder = trialReminderDate(charge);
  const view = render(<PaywallOfferTimeline terms={terms} now={now} reminderAvailability="enabled" />);
  expect(charge.toDateString()).toBe(new Date(2026, 8, 30 + days, 12).toDateString());
  expect(view.getByTestId('paywall-step-today')).toBeTruthy();
  expect(view.getByTestId('paywall-step-reminder')).toBeTruthy();
  expect(view.getByTestId('paywall-step-charge')).toBeTruthy();
  expect(view.getByText(`In ${days} days`)).toBeTruthy();
  const reminderDay = Math.round((Date.UTC(reminder.getFullYear(), reminder.getMonth(), reminder.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
  expect(reminderDay).toBe(days - 2);
  expect(view.getByText(`In ${reminderDay} days`)).toBeTruthy();
  expect(view.getByText("We'll send you a reminder that your trial is ending soon if the store confirms this trial end after purchase.")).toBeTruthy();
  expect(view.getByText('Unlock our library of Los Angeles restaurant nutrition, tailored to you')).toBeTruthy();
  expect(view.getByText(`Estimated first charge: ${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(charge)}, if you start today. The store confirms your actual date after purchase.`)).toBeTruthy();
  expect(view.queryByText(/\$79|\$9/)).toBeNull();
  expect(view.queryByText(/Your Fitsy plan/)).toBeNull();
});

test('an accelerated confirmed entitlement does not inherit the projected reminder promise', () => {
  const terms = purchaseTerms(product('P2W', '$79.99'), true);
  const view = render(<PaywallOfferTimeline terms={terms} now={now} reminderAvailability="enabled" />);
  expect(view.getByText(/if the store confirms this trial end after purchase/)).toBeTruthy();
  expect(view.getByText(/The store confirms your actual date after purchase/)).toBeTruthy();
  const expiry = new Date(now.getTime() + 10 * 60_000);
  expect(planReminders({ now, userId: 'buyer', entitled: true, preferences: { meals: false, trial: true },
    subscription: { isActive: true, periodType: 'TRIAL', willRenew: true,
      latestPurchaseDate: now.toISOString(), expirationDate: expiry.toISOString() } })).toEqual([]);
});

test('a morning trial labels the actual quiet-hours reminder day', () => {
  const morning = new Date(2026, 9, 1, 8);
  const terms = purchaseTerms(product('P2W', '$79.99'), true);
  const charge = projectedChargeDate(terms, morning)!;
  const reminder = trialReminderDate(charge);
  expect(reminder).toEqual(new Date(2026, 9, 12, 19));
  expect(charge.getTime() - reminder.getTime()).toBeGreaterThanOrEqual(48 * 3_600_000);
  const view = render(<PaywallOfferTimeline terms={terms} now={morning} reminderAvailability="enabled" />);
  expect(view.getByText('In 11 days')).toBeTruthy();
  expect(view.getByText('In 14 days')).toBeTruthy();
});

test('fall daylight saving does not add a day to the two-day reminder label', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const start = new Date(2026, 9, 19, 9);
    const terms = purchaseTerms(product('P2W', '$79.99'), true);
    const charge = projectedChargeDate(terms, start)!;
    const reminder = trialReminderDate(charge);
    expect(charge.toDateString()).toBe(new Date(2026, 10, 2, 9).toDateString());
    expect(reminder.toDateString()).toBe(new Date(2026, 9, 31, 10).toDateString());
    const view = render(<PaywallOfferTimeline terms={terms} now={start} reminderAvailability="enabled" />);
    expect(view.getByText('In 12 days')).toBeTruthy();
    expect(view.getByText('In 14 days')).toBeTruthy();
  } finally { process.env.TZ = previousTimezone; }
});

test('reminder states do not promise delivery without permission and opt-in', () => {
  const terms = purchaseTerms(product('P1W', '$9.99', 'P1M'), true);
  const view = render(<PaywallOfferTimeline terms={terms} now={now} reminderAvailability="permission-off" />);
  expect(view.getByText(/Notifications off/)).toBeTruthy();
  view.rerender(<PaywallOfferTimeline terms={terms} now={now} reminderAvailability="enabled" />);
  expect(view.getByText(/We'll send you a reminder/)).toBeTruthy();
  view.rerender(<PaywallOfferTimeline terms={terms} now={now} reminderAvailability="opt-in" />);
  expect(view.getByText(/turn on reminders after purchase/)).toBeTruthy();
  view.rerender(<PaywallOfferTimeline terms={terms} now={now} reminderAvailability="unavailable" />);
  expect(view.getByText(/Unavailable; check your trial end/)).toBeTruthy();
});

test.each([
  [new Date(2026, 0, 31, 12), 'P1M', new Date(2026, 1, 28, 12)],
  [new Date(2024, 1, 29, 12), 'P1Y', new Date(2025, 1, 28, 12)],
])('calendar trial ending on a short month is clamped to its last day', (start, period, expected) => {
  const terms = purchaseTerms(product(period, '$79.99'), true);
  expect(projectedChargeDate(terms, start)?.toDateString()).toBe(expected.toDateString());
});

test('connectors use their own wrapping row height and meet the next circle edge', () => {
  const terms = purchaseTerms(product('P1W', '$9.99', 'P1M'), true);
  const view = render(<PaywallOfferTimeline terms={terms} now={now} />);
  for (const id of ['paywall-step-today', 'paywall-step-reminder']) {
    const row = StyleSheet.flatten(view.getByTestId(id).props.style);
    const connector = StyleSheet.flatten(view.getByTestId(`${id}-connector`).props.style);
    const circle = StyleSheet.flatten(view.getByTestId(`${id}-circle`).props.style);
    expect(row.height).toBeUndefined();
    expect(connector.top).toBe(circle.height);
    expect(connector.bottom).toBe(0);
    expect(connector.left + connector.width / 2).toBe(circle.width / 2);
  }
  expect(view.queryByTestId('paywall-step-charge-connector')).toBeNull();
});

test('ineligible offer shows only the three supported benefits in main content', () => {
  const terms = purchaseTerms(product('P2W', '$79.99'), false);
  expect(projectedChargeDate(terms, now)).toBeNull();
  const view = render(<PaywallOfferTimeline terms={terms} now={now} />);
  expect(view.getByTestId('paywall-offer-paid')).toBeTruthy();
  expect(view.queryByTestId('paywall-step-reminder')).toBeNull();
  for (const benefit of PAYWALL_BENEFITS) expect(view.getByText(benefit)).toBeTruthy();
  expect(view.queryByText(/Unlock Fitsy|when you confirm|Renewal/)).toBeNull();
});
