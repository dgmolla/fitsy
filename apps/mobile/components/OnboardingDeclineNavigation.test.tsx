jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Pressable, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Tabs from '../app/(tabs)/_layout';
import HowItWorks from '../app/welcome/how-it-works';
import Preview from '../app/welcome/preview';
import { PurchasesProvider } from '../lib/usePurchases';
import { rememberPaywallDecline } from '../lib/paywallAccess';
import { saveOnboardingField } from '../lib/onboardingStorage';
import { saveMacroTargets } from '../lib/macroStorage';
import { usePreviewAccess } from '../lib/usePreviewAccess';
import { rememberOnboardingPreviewEntry } from '../lib/onboardingPreviewEntry';

function AccessProbe() {
  const direct = usePreviewAccess();
  const onboarding = usePreviewAccess(true);
  return <Text testID="access-probe">{`direct:${direct.canPreview}|onboarding:${onboarding.canPreview}`}</Text>;
}

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture() {} }));
});
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    startAutoRefresh() {}, stopAutoRefresh() {},
  } }) };
});
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { revenueCat: { ios: 'test-store-key' } } } } }));
jest.mock('../components/DiscoveryScreen', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const { routeToPaywall } = require('../lib/teaserGate');
  return { DiscoveryScreen: ({ onPreviewBack }: { onPreviewBack?: () => void }) => React.createElement(View, { testID: 'preview-guide' },
    React.createElement(Pressable, { testID: 'preview-back', onPress: onPreviewBack }, React.createElement(Text, null, 'Back')),
    React.createElement(Pressable, { testID: 'locked-full-menu', onPress: () => { void routeToPaywall(); } },
      React.createElement(Text, null, 'Full menu with Pro'))) };
});

it.each(['/search?preview=1', '/welcome/preview', '/welcome/preview?entry=onboarding'])('keeps a declined anonymous user on payment when opening %s', async (initialUrl) => {
  await AsyncStorage.clear();
  await rememberPaywallDecline();
  const screen = renderRouter({
    _layout: () => <PurchasesProvider><Stack /></PurchasesProvider>,
    '(tabs)/_layout': Tabs, '(tabs)/search': () => <Text>Search results</Text>,
    'welcome/preview': Preview, 'welcome/signin': () => <Text>Create an account</Text>,
    'welcome/payment': () => <Text>Payment plans</Text>,
  }, { initialUrl });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.queryByText('Create an account')).toBeNull();
  expect(screen.queryByText('Search results')).toBeNull();
});

it('allows a returning onboarding preview after decline but still gates full menus', async () => {
  await AsyncStorage.clear();
  await rememberPaywallDecline();
  await saveOnboardingField('goal', 'lose_fat');
  await saveMacroTargets({ calories: '600', protein: '0', carbs: '0', fat: '0' });
  const screen = renderRouter({
    _layout: () => <PurchasesProvider><AccessProbe /><Stack /></PurchasesProvider>,
    '(tabs)/_layout': Tabs, '(tabs)/search': () => <Text>Paid search results</Text>,
    'welcome/how-it-works': () => <HowItWorks />, 'welcome/preview': Preview,
    'welcome/signin': () => <Text>Create an account</Text>,
    'welcome/payment': () => <><Text>Payment plans</Text><Pressable testID="payment-back" onPress={() => router.back()}><Text>Back</Text></Pressable></>,
  }, { initialUrl: '/welcome/how-it-works' });
  await screen.findByTestId('nutrition-source-published');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByTestId('preview-guide')).toBeTruthy();
  expect(await AsyncStorage.getItem('@fitsy/onboardingPreviewEntry')).toBe('1');
  await waitFor(() => expect(screen.getByTestId('access-probe').props.children).toBe('direct:false|onboarding:true'));
  expect(screen.queryByText('Paid search results')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('preview-back')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/how-it-works'));
  expect(await AsyncStorage.getItem('@fitsy/onboardingPreviewEntry')).toBeNull();
  await act(async () => { router.push('/welcome/preview'); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  await act(async () => { router.push('/welcome/how-it-works'); });
  await screen.findByTestId('nutrition-source-published');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByTestId('preview-guide')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('locked-full-menu')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.queryByText('Paid search results')).toBeNull();
  expect(await AsyncStorage.getItem('@fitsy/paywallDeclined')).toBe('1');
  expect(await AsyncStorage.getItem('@fitsy/onboardingPreviewEntry')).toBeNull();
  await waitFor(() => expect(screen.getByTestId('access-probe').props.children).toBe('direct:false|onboarding:false'));
  await act(async () => { fireEvent.press(screen.getByTestId('payment-back')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/payment'));
  expect(screen.queryByTestId('preview-guide')).toBeNull();
});

it('leaves a cold-start preview when Back has no navigation history', async () => {
  await AsyncStorage.clear();
  await rememberPaywallDecline();
  await saveOnboardingField('goal', 'lose_fat');
  await saveMacroTargets({ calories: '600', protein: '0', carbs: '0', fat: '0' });
  await rememberOnboardingPreviewEntry();
  const screen = renderRouter({
    _layout: () => <PurchasesProvider><Stack /></PurchasesProvider>,
    'welcome/how-it-works': () => <HowItWorks />, 'welcome/preview': Preview,
    'welcome/payment': () => <Text>Payment plans</Text>,
  }, { initialUrl: '/welcome/preview' });
  await screen.findByTestId('preview-guide');
  await act(async () => { fireEvent.press(screen.getByTestId('preview-back')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/how-it-works'));
  expect(await AsyncStorage.getItem('@fitsy/onboardingPreviewEntry')).toBeNull();
});
