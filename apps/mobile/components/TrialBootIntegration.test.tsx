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
import { mockRc, setupPurchasesMocks, useFakeTimersKeepingFlush } from '../lib/usePurchasesTestKit';
import { BOOT_VERDICT_CAP_MS, PurchasesProvider } from '../lib/usePurchases';
import TrialScreen from '../app/welcome/trial';

jest.mock('../lib/onboardingResume', () => ({ useOnboardingStep: () => undefined }));
setupPurchasesMocks();
afterEach(() => jest.useRealTimers());
afterEach(() => mockRc.fetchCurrentOffering.mockReset().mockResolvedValue(null));

const routes = {
  _layout: () => <PurchasesProvider><Stack screenOptions={{ headerShown: false }} /></PurchasesProvider>,
  'welcome/trial': TrialScreen,
  'welcome/payment': () => <Text>Payment plans</Text>,
};

test('a never-settling boot offering request eventually exposes Retry plans on the real trial route', async () => {
  mockRc.fetchCurrentOffering.mockImplementation(() => new Promise(() => {}));
  useFakeTimersKeepingFlush();
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await act(async () => { jest.advanceTimersByTime(5500); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Retry plans');
});

test('a stalled boot identity leaves trial eligibility unknown and permits plan review', async () => {
  mockRc.identifyPurchasesUser.mockImplementationOnce(() => new Promise(() => {}));
  mockRc.fetchCurrentOffering.mockResolvedValue({ availablePackages: [], annual: null, monthly: null } as never);
  useFakeTimersKeepingFlush();
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(BOOT_VERDICT_CAP_MS); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Continue');
  fireEvent.press(screen.getByTestId('welcome-continue'));
  expect(screen.getPathname()).toBe('/welcome/payment');
});

test('a rejected boot catalog exposes Retry plans, then a successful retry continues to plan review', async () => {
  mockRc.fetchCurrentOffering.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ availablePackages: [], annual: null, monthly: null } as never);
  const screen = renderRouter(routes, { initialUrl: '/welcome/trial' });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Retry plans'));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityLabel).toBe('Continue'));
  fireEvent.press(screen.getByTestId('welcome-continue'));
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
});

test('late boot catalog completion after focus exit cannot navigate the old trial route', async () => {
  let resolveCatalog!: (offering: null) => void;
  mockRc.fetchCurrentOffering.mockImplementationOnce(() => new Promise(resolve => { resolveCatalog = resolve; }))
    .mockResolvedValue(null);
  const screen = renderRouter({ ...routes, 'welcome/preview': () => <Text>Preview</Text> }, { initialUrl: '/welcome/trial' });
  await act(async () => { router.push('/welcome/preview'); });
  await act(async () => { resolveCatalog(null); });
  expect(screen.getPathname()).toBe('/welcome/preview');
});
