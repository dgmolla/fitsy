jest.unmock('react-native');
jest.unmock('expo-router');
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture() {}, identify() {} }));
});

import React from 'react';
import { Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import TrialScreen from '../app/welcome/trial';

jest.mock('../lib/onboardingResume', () => ({ useOnboardingStep: () => undefined }));
const mockRefreshOffering = jest.fn();
let mockEligibility: Record<string, boolean> = {};
let mockEligibilityReady = true;
const annual = { product: { identifier: 'annual', priceString: '$59.99', subscriptionPeriod: 'P1Y',
  introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } };
let mockOffering: { annual: typeof annual; monthly: { product: { identifier: string; priceString: string; subscriptionPeriod: string; introPrice: null } } | null } | null = {
  annual, monthly: { product: { identifier: 'monthly', priceString: '$9.99', subscriptionPeriod: 'P1M', introPrice: null } },
};
jest.mock('../lib/usePurchases', () => ({ usePurchases: () => ({
  offering: mockOffering,
  ready: true, introEligibilityReady: mockEligibilityReady, introEligibility: mockEligibility, refreshOffering: mockRefreshOffering, entitled: false,
}) }));

const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  'welcome/trial': TrialScreen,
  'welcome/trial-reminder': () => <Text>Trial reminder choice</Text>,
  'welcome/payment': () => <Text>Payment plans</Text>,
  'welcome/preview': () => <Text>Discovery preview</Text>,
};

afterEach(() => { jest.useRealTimers(); mockRefreshOffering.mockReset(); });

test('a stalled automatic offering retry becomes a usable Retry plans action', async () => {
  mockOffering = null;
  mockEligibilityReady = false;
  mockEligibility = {};
  mockRefreshOffering.mockImplementation(() => new Promise(() => {}));
  jest.useFakeTimers();
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Checking plans…');
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Retry plans');
});

test('a stalled button retry times out, ignores its late result, and allows another attempt', async () => {
  mockOffering = null;
  mockEligibilityReady = false;
  mockEligibility = {};
  let resolveLate!: (value: null) => void;
  mockRefreshOffering.mockResolvedValueOnce(null)
    .mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve; }))
    .mockResolvedValueOnce(null);
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Retry plans'));
  jest.useFakeTimers();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Checking plans…');
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Retry plans');
  await act(async () => { resolveLate(null); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Retry plans');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(mockRefreshOffering).toHaveBeenCalledTimes(3);
  expect(screen.getPathname()).toBe('/welcome/trial');
});

test('leaving a pending offering retry cannot redirect and refocus starts a fresh check', async () => {
  mockOffering = null;
  mockEligibilityReady = false;
  mockEligibility = {};
  let resolveLate!: (value: null) => void;
  mockRefreshOffering.mockImplementationOnce(() => new Promise(resolve => { resolveLate = resolve; }))
    .mockResolvedValueOnce(null);
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Checking plans…');
  await act(async () => { router.push('/welcome/preview'); });
  await act(async () => { resolveLate(null); });
  expect(screen.getPathname()).toBe('/welcome/preview');
  await act(async () => { router.back(); });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Retry plans'));
  expect(mockRefreshOffering).toHaveBeenCalledTimes(2);
});

test.each([
  ['eligible', { annual: true }, '/welcome/trial-reminder'],
  ['ineligible', { annual: false }, '/welcome/payment'],
  ['unknown', {}, '/welcome/payment'],
] as const)('pending eligibility transitions to %s route after refocus', async (_label, eligibility, destination) => {
  mockOffering = { annual, monthly: null };
  mockEligibilityReady = false;
  mockEligibility = {};
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  fireEvent.press(screen.getByTestId('welcome-continue'));
  expect(screen.getPathname()).toBe('/welcome/trial');
  mockEligibility = eligibility;
  mockEligibilityReady = true;
  await act(async () => { router.push('/welcome/preview'); });
  await act(async () => { router.back(); });
  if (_label === 'eligible') {
    await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Continue'));
    fireEvent.press(screen.getByTestId('welcome-continue'));
  }
  await waitFor(() => expect(screen.getPathname()).toBe(destination));
});

test.each([
  ['ineligible', { annual: false, monthly: false }],
  ['unknown', {}],
])('%s trial eligibility routes directly to plans without an interstitial', async (_label, eligibility) => {
  mockOffering = { annual, monthly: { product: { identifier: 'monthly', priceString: '$9.99', subscriptionPeriod: 'P1M', introPrice: null } } };
  mockEligibilityReady = true;
  mockEligibility = eligibility;
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.queryByText('Find your next meal with Fitsy.')).toBeNull();
  expect(screen.queryByText('Trial reminder choice')).toBeNull();
});

test('eligible trial introduction keeps the optional reminder choice', async () => {
  mockOffering = { annual, monthly: null };
  mockEligibilityReady = true;
  mockEligibility = { annual: true, monthly: false };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await waitFor(() => expect(screen.getByText('We want you to try Fitsy for free.')).toBeTruthy());
  fireEvent.press(screen.getByTestId('welcome-continue'));
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial-reminder'));
});

test('pending eligibility holds Continue before choosing the reminder or plans', async () => {
  mockOffering = { annual, monthly: null };
  mockEligibilityReady = false;
  mockEligibility = {};
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  fireEvent.press(screen.getByTestId('welcome-continue'));
  expect(screen.getPathname()).toBe('/welcome/trial');
});

test('missing offering requires an explicit retry before trial routing', async () => {
  mockOffering = null;
  mockEligibilityReady = false;
  mockRefreshOffering.mockResolvedValue(null);
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Retry plans'));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(screen.getPathname()).toBe('/welcome/trial');
  expect(mockRefreshOffering).toHaveBeenCalled();
});
