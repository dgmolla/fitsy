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
import { Stack } from 'expo-router';
import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import TrialScreen from '../app/welcome/trial';

jest.mock('../lib/onboardingResume', () => ({ useOnboardingStep: () => undefined }));
const mockRefreshOffering = jest.fn();
let mockEligibility: Record<string, boolean> = {};
let mockEligibilityReady = true;
jest.mock('../lib/usePurchases', () => ({ usePurchases: () => ({
  offering: { annual: { product: { identifier: 'annual', priceString: '$59.99', subscriptionPeriod: 'P1Y',
    introPrice: { price: 0, priceString: '$0', period: 'P1W', cycles: 1 } } }, monthly: { product: {
    identifier: 'monthly', priceString: '$9.99', subscriptionPeriod: 'P1M', introPrice: null } } },
  ready: true, introEligibilityReady: mockEligibilityReady, introEligibility: mockEligibility, refreshOffering: mockRefreshOffering, entitled: false,
}) }));

const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  'welcome/trial': TrialScreen,
  'welcome/trial-reminder': () => <Text>Trial reminder choice</Text>,
  'welcome/payment': () => <Text>Payment plans</Text>,
};

test.each([
  ['ineligible', { annual: false, monthly: false }],
  ['unknown', {}],
])('%s trial introduction continues straight to plans without a trial reminder', async (_label, eligibility) => {
  mockEligibilityReady = true;
  mockEligibility = eligibility;
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await waitFor(() => expect(screen.getByText('Find your next meal with Fitsy.')).toBeTruthy());
  fireEvent.press(screen.getByTestId('welcome-continue'));
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.queryByText('Trial reminder choice')).toBeNull();
});

test('eligible trial introduction keeps the optional reminder choice', async () => {
  mockEligibilityReady = true;
  mockEligibility = { annual: true, monthly: false };
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await waitFor(() => expect(screen.getByText('We want you to try Fitsy for free.')).toBeTruthy());
  fireEvent.press(screen.getByTestId('welcome-continue'));
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/trial-reminder'));
});

test('pending eligibility holds Continue before choosing the reminder or plans', async () => {
  mockEligibilityReady = false;
  mockEligibility = {};
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  fireEvent.press(screen.getByTestId('welcome-continue'));
  expect(screen.getPathname()).toBe('/welcome/trial');
});
