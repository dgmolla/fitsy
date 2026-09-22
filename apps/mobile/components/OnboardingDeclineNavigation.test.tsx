jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import { renderRouter, waitFor } from 'expo-router/testing-library';
import Tabs from '../app/(tabs)/_layout';
import Preview from '../app/welcome/preview';
import { PurchasesProvider } from '../lib/usePurchases';
import { rememberPaywallDecline } from '../lib/paywallAccess';

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

it.each(['/search?preview=1', '/welcome/preview'])('keeps a declined anonymous user on payment when opening %s', async (initialUrl) => {
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
