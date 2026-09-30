jest.unmock('react-native');
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) };
});
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture() {}, identify() {} }));
});
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn().mockImplementation(() => new Promise(() => {})) }));
import React from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaywallView } from './PaywallView';
import { PaywallTimeline } from './PaywallTimeline';
import { purchaseTerms } from '../lib/purchaseTerms';

const product = { priceString: '$59.99', subscriptionPeriod: 'P1Y',
  introPrice: { price: 0, priceString: '$0.00', period: 'P1W', periodUnit: 'WEEK', periodNumberOfUnits: 1, cycles: 1 } };
const annual = purchaseTerms(product, true);
const monthly = purchaseTerms({ ...product, priceString: '$9.99', subscriptionPeriod: 'P1M', introPrice: null }, false);
function props() { return { annual, monthly, plan: 'yearly' as const, loading: false, restoring: false, checkingPlans: false,
  annualSavingPercent: 50, discovery: { selected: { id: 'r1', name: 'Actual Preview Pick', photoUrl: 'https://example.com/restaurant.jpg', address: '123 Main', lat: 34, lng: -118, distanceMiles: 1, cuisineTags: [], chainFlag: false, bestMatch: { menuItemId: 'm1', name: 'Real bowl', calories: 500, proteinG: 40, carbsG: 45, fatG: 15, confidence: 'HIGH' as const, matchScore: 0.2, nutritionBasis: 'estimated' as const } } },
  onSelect: jest.fn(), onRestore: jest.fn(), onManage: jest.fn(), onRetry: jest.fn(), onPurchase: jest.fn(), onDecline: jest.fn() }; }

test('timeline derives trial end and reminder day from the selected store offer', () => {
  const screen = render(<PaywallTimeline terms={annual} />);
  expect(screen.getByText('Day 1: trial access')).toBeTruthy();
  expect(screen.getByText('Day 6: optional reminder')).toBeTruthy();
  expect(screen.getByText('Day 7: first charge')).toBeTruthy();
  expect(screen.getByText('$59.99 every 1 year after the full trial period, unless canceled at least 24 hours before it ends.')).toBeTruthy();
  screen.rerender(<PaywallTimeline terms={purchaseTerms({ ...product, introPrice: { ...product.introPrice, period: 'P2W' } }, true)} />);
  expect(screen.getByText('Day 13: optional reminder')).toBeTruthy();
  expect(screen.getByText('Day 14: first charge')).toBeTruthy();
});

test('denied permission gives a concise disabled state instead of promising delivery', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: 'denied' } as Notifications.NotificationPermissionsStatus);
  const screen = render(<PaywallTimeline terms={annual} />);
  await waitFor(() => expect(screen.getByText('Reminders are off')).toBeTruthy());
  expect(screen.getByText('Turn on notifications in device settings to receive one.')).toBeTruthy();
  await act(async () => { screen.unmount(); });
});

test('granted permission remains conditional until a native request is scheduled', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: 'granted' } as Notifications.NotificationPermissionsStatus);
  const screen = render(<PaywallTimeline terms={annual} />);
  await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
  expect(screen.getByText('Day 6: optional reminder')).toBeTruthy();
  expect(screen.getByText('Requires permission and a store-confirmed trial end date.')).toBeTruthy();
});

test('a stale denied response cannot replace a newer granted permission', async () => {
  let first!: (value: Notifications.NotificationPermissionsStatus) => void;
  let second!: (value: Notifications.NotificationPermissionsStatus) => void;
  jest.mocked(Notifications.getPermissionsAsync)
    .mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  let onAppState!: (state: 'active') => void;
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    onAppState = callback as typeof onAppState;
    return { remove: jest.fn() } as never;
  });
  try {
    const screen = render(<PaywallTimeline terms={annual} />);
    act(() => onAppState('active'));
    await act(async () => second({ status: 'granted' } as Notifications.NotificationPermissionsStatus));
    await act(async () => first({ status: 'denied' } as Notifications.NotificationPermissionsStatus));
    expect(screen.getByText('Day 6: optional reminder')).toBeTruthy();
    expect(screen.queryByText('Reminders are off')).toBeNull();
  } finally { listener.mockRestore(); }
});

test('browser timeline does not promise a notification for an eligible trial', () => {
  const originalOS = Platform.OS;
  Platform.OS = 'web';
  try {
    const screen = render(<PaywallTimeline terms={annual} />);
    expect(screen.getByText('Reminder unavailable in this browser')).toBeTruthy();
    expect(screen.getByText('Trial notifications require the Fitsy mobile app.')).toBeTruthy();
    expect(screen.queryByText('Day 6: optional reminder')).toBeNull();
    expect(screen.getByText('Day 7: first charge')).toBeTruthy();
  } finally { Platform.OS = originalOS; }
});

test('ineligible and unknown offers never promise a free trial or notification', () => {
  const screen = render(<PaywallTimeline terms={purchaseTerms(product, false)} />);
  expect(screen.getByText('$59.99 charged when you confirm your purchase.')).toBeTruthy();
  expect(screen.queryByText(/reminder/i)).toBeNull();
  screen.rerender(<PaywallTimeline terms={purchaseTerms(product)} />);
  expect(screen.getByText(/store will confirm any eligible introductory offer/)).toBeTruthy();
  expect(screen.queryByText(/reminder/i)).toBeNull();
  expect(screen.queryByText(/charged when you confirm/)).toBeNull();
});

test('calendar trials are not converted to invented day counts', () => {
  const screen = render(<PaywallTimeline terms={purchaseTerms({ ...product, introPrice: { ...product.introPrice, period: 'P1M' } }, true)} />);
  expect(screen.getByText('After 1 month: first charge')).toBeTruthy();
  expect(screen.queryByText(/Day 30/)).toBeNull();
});

test('the final paywall has selected offer terms without repeating the trial timeline', () => {
  const short = purchaseTerms({ ...product, subscriptionPeriod: 'P1M', introPrice: { ...product.introPrice, period: 'P2D' } }, true);
  const p = { ...props(), monthly: short };
  const screen = render(<PaywallView {...p} />);
  expect(screen.queryByTestId('paywall-timeline')).toBeNull();
  screen.rerender(<PaywallView {...p} plan="monthly" />);
  expect(screen.getByTestId('paywall-terms').props.children).toContain('2 days free');
  screen.rerender(<PaywallView {...p} plan="yearly" />);
  expect(screen.getByTestId('paywall-terms').props.children).toContain('7 days free');
});

test('plan selection, purchase, restore and decline remain operable with live totals', () => {
  const p = props();
  const screen = render(<PaywallView {...p} />);
  expect(screen.getByText('Find meals that fit.')).toBeTruthy();
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Start free trial');
  expect(screen.getByTestId('paywall-restaurant-name').props.children).toBe('Actual Preview Pick');
  expect(screen.getByTestId('paywall-annual-saving').props.children).toEqual(['Save ', 50, '%']);
  expect(screen.getByTestId('paywall-price-yearly').props.children).toBe('$59.99');
  fireEvent.press(screen.getByTestId('paywall-plan-monthly'));
  expect(p.onSelect).toHaveBeenCalledWith('monthly');
  fireEvent.press(screen.getByTestId('welcome-continue'));
  expect(p.onPurchase).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('paywall-restore'));
  expect(p.onRestore).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('paywall-manage-link'));
  expect(p.onManage).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('welcome-skip'));
  expect(p.onDecline).toHaveBeenCalledTimes(1);
  screen.rerender(<PaywallView {...p} plan="monthly" />);
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Continue to purchase');
  expect(screen.getByTestId('paywall-terms').props.children).toContain('Fitsy Pro');
  expect(screen.getByTestId('paywall-terms').props.children).toContain('$9.99 when you confirm');
  expect(screen.queryByText(/trial access/i)).toBeNull();
});

test('unavailable pricing disables purchases and provides retry without inventing terms', () => {
  const p = { ...props(), annual: null, monthly: null };
  const screen = render(<PaywallView {...p} />);
  fireEvent.press(screen.getByTestId('welcome-continue'));
  expect(p.onPurchase).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('paywall-retry-pricing'));
  expect(p.onRetry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/free trial/i)).toBeNull();
});

test('variant B follows selected plan and shows truthful paid state when trial is unavailable', () => {
  const p = props();
  const screen = render(<PaywallView {...p} variant="B" />);
  expect(screen.getByTestId('paywall-offer-timeline')).toBeTruthy();
  expect(screen.getByText('Your Fitsy trial')).toBeTruthy();
  expect(screen.queryByTestId('paywall-restaurant-card')).toBeNull();
  screen.rerender(<PaywallView {...p} variant="B" plan="monthly" />);
  expect(screen.getByText('Your Fitsy plan')).toBeTruthy();
  expect(screen.queryByText(/reminder/i)).toBeNull();
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Continue to purchase');
  expect(screen.getByTestId('paywall-terms').props.children).toContain('$9.99 when you confirm');
});
