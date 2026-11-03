import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasAccountOnboarding, readAccountHistory, rememberAccountHistory, rememberAccountOnboarding } from './accountHistory';
import { supabase } from './supabase';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('./supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));

beforeEach(async () => { await AsyncStorage.clear(); });

it('keeps a fresh or unfinished anonymous setup distinct from a prior account', async () => {
  expect(await readAccountHistory()).toBe(false);
  await AsyncStorage.multiSet([
    ['@fitsy/onboarding', JSON.stringify({ goal: 'lose_fat', _owner: null })],
    ['@fitsy/macro_targets', JSON.stringify({ protein: '40', _owner: null })],
    ['@fitsy/onboardingStep', 'signin'],
  ]);
  expect(await readAccountHistory()).toBe(false);
});

it.each(['@fitsy/onboarding', '@fitsy/macro_targets', '@fitsy/macro_targets:prior-account', '@fitsy/search_macro_targets:prior-account'])(
  'recognizes retained account ownership in %s without changing it', async key => {
    const saved = JSON.stringify({ _owner: 'prior-account', protein: '40' });
    await AsyncStorage.setItem(key, saved);
    expect(await readAccountHistory()).toBe(true);
    expect(await AsyncStorage.getItem(key)).toBe(saved);
  },
);

it('does not treat malformed or unowned legacy measurements as account history', async () => {
  await AsyncStorage.multiSet([
    ['@fitsy/onboarding', '{invalid'],
    ['@fitsy/macro_targets', JSON.stringify({ protein: '40' })],
  ]);
  expect(await readAccountHistory()).toBe(false);
});

it('remembers use without storing an account identity or clearing temporary state', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'tuning');
  await rememberAccountHistory();
  expect(await readAccountHistory()).toBe(true);
  expect(await AsyncStorage.getItem('@fitsy/onboardingStep')).toBe('tuning');
});

it('resumes new-account setup only for its signed-in owner and can retire it without erasing progress', async () => {
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'goal');
  await rememberAccountOnboarding('new-account');
  for (const id of ['new-account', 'different-account', null]) {
    jest.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: id ? { user: { id } } : null } } as never);
    expect(await hasAccountOnboarding()).toBe(id === 'new-account');
  }
  await rememberAccountOnboarding(null);
  expect(await hasAccountOnboarding()).toBe(false);
  expect(await AsyncStorage.getItem('@fitsy/onboardingStep')).toBe('goal');
});
