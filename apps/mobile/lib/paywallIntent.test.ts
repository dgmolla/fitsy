import AsyncStorage from '@react-native-async-storage/async-storage';
import { claimPaywallIntent, clearPaywallIntent, getPaywallIntent, getPurchasedContinuation, markPurchasedContinuation, rememberPaywallIntent } from './paywallIntent';

let mockUserId: string | null = null;
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: mockUserId ? { user: { id: mockUserId } } : null } }),
  startAutoRefresh: () => undefined,
  stopAutoRefresh: () => undefined,
  } }) };
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const choice = { restaurantId: 'restaurant', menuItemId: 'pasta', action: 'save' as const };
beforeEach(async () => { mockUserId = null; await clearPaywallIntent(); jest.restoreAllMocks(); });

test('the explicit sign-in continuation preserves the anonymous meal choice', async () => {
  await rememberPaywallIntent(choice);
  expect(await getPaywallIntent()).toEqual(choice);
  mockUserId = 'account-a';
  expect(await getPaywallIntent()).toBeNull();
  await claimPaywallIntent('account-a');
  expect(await getPaywallIntent()).toEqual(choice);
});

test('a different account cannot read or claim an earlier account selection', async () => {
  mockUserId = 'account-a';
  await rememberPaywallIntent(choice);
  mockUserId = 'account-b';
  expect(await getPaywallIntent()).toBeNull();
  await claimPaywallIntent('account-b');
  expect(await getPaywallIntent()).toBeNull();
  mockUserId = 'account-a';
  expect(await getPaywallIntent()).toBeNull();
});

test('abandoning the flow removes the choice before another sign-in', async () => {
  await rememberPaywallIntent(choice);
  await clearPaywallIntent();
  mockUserId = 'account-b';
  await claimPaywallIntent('account-b');
  expect(await getPaywallIntent()).toBeNull();
});

test('old pending selections expire instead of replaying on a later visit', async () => {
  await rememberPaywallIntent(choice);
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
  jest.spyOn(Date, 'now').mockReturnValue(tomorrow);
  expect(await getPaywallIntent()).toBeNull();
  await claimPaywallIntent('account-b');
  expect(await AsyncStorage.getItem('@fitsy/paywallIntent')).toBeNull();
});

test('legacy selections without account and age metadata are not replayed', async () => {
  await AsyncStorage.setItem('@fitsy/paywallIntent', JSON.stringify(choice));
  expect(await getPaywallIntent()).toBeNull();
});

test('only an owned purchased continuation survives restart, never anonymous or another account', async () => {
  await rememberPaywallIntent(choice);
  await markPurchasedContinuation();
  expect(await getPurchasedContinuation()).toBeNull();
  mockUserId = 'account-a';
  await claimPaywallIntent('account-a');
  await markPurchasedContinuation();
  expect(await getPurchasedContinuation()).toEqual(choice);
  mockUserId = 'account-b';
  expect(await getPurchasedContinuation()).toBeNull();
  mockUserId = null;
  expect(await getPurchasedContinuation()).toBeNull();
});

test('a new preview selection or abandonment cannot reuse the purchased marker', async () => {
  mockUserId = 'account-a';
  await rememberPaywallIntent(choice);
  await markPurchasedContinuation();
  await rememberPaywallIntent({ action: 'discovery', query: 'salad' });
  expect(await getPurchasedContinuation()).toBeNull();
  await markPurchasedContinuation();
  await clearPaywallIntent();
  expect(await getPurchasedContinuation()).toBeNull();
});

test('purchased continuations expire with their original selection', async () => {
  mockUserId = 'account-a';
  await rememberPaywallIntent(choice);
  await markPurchasedContinuation();
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
  expect(await getPurchasedContinuation()).toBeNull();
});
