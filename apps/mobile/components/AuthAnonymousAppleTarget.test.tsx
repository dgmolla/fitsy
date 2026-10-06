jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Login from '../app/auth/login';
import { getMacroTargets, saveMacroTargets } from '../lib/macroStorage';
import { saveOnboardingField } from '../lib/onboardingStorage';
import { pullProfileFromServer } from '../lib/profileSync';

type Session = { access_token: string; user: { id: string } } | null;
let mockSession: Session = null;
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession() {} }));
jest.mock('posthog-react-native', () => jest.fn().mockImplementation(() => ({
  capture: jest.fn(), identify: jest.fn(),
})));
jest.mock('expo-auth-session/providers/google', () => ({ useIdTokenAuthRequest: () => [null, null, () => {}] }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: async () => ({ identityToken: 'external-apple-token', authorizationCode: 'external-code' }),
}));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  return { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: mockSession } }),
    setSession: async (tokens: { access_token: string }) => {
      mockSession = { access_token: tokens.access_token, user: { id: 'new-apple' } };
      return { data: { session: mockSession }, error: null };
    },
  } }) };
});

it('claims, synchronizes and restores an intentional anonymous target for a new Apple account', async () => {
  await AsyncStorage.clear();
  mockSession = null;
  const target = { protein: '80', carbs: '75', fat: '21', calories: '809' };
  await saveOnboardingField('goal', 'performance');
  await saveMacroTargets(target, 'complete', 'manual');
  const originalFetch = global.fetch;
  let serverTarget: Record<string, unknown> | null = null;
  let serverGoal: string | null = null;
  global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
    const body = url.endsWith('/api/auth/apple') ? {
      token: 'new-apple-token', refreshToken: 'external-refresh',
      user: { id: 'new-apple', email: 'fixture@example.test' }, isNewUser: true,
    } : { user: { birthday: null, heightCm: null, weightKg: null, sex: null,
      activityLevel: null, goal: serverGoal }, macroTarget: serverTarget };
    if (init?.method === 'PATCH') {
      const saved = JSON.parse(String(init.body)); serverTarget = saved.macroTarget; serverGoal = saved.goal;
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
  try {
    const screen = renderRouter({ 'auth/login': Login, '(tabs)/search': () => <Text>Meal search</Text> },
      { initialUrl: '/auth/login' });
    fireEvent.press(screen.getByText('Continue with Apple'));
    await waitFor(() => expect(screen.getByText('Meal search')).toBeTruthy());
    expect(await getMacroTargets()).toEqual(target);
    expect(serverTarget).toEqual({ proteinG: 280, carbsG: 263, fatG: 74, calories: 2838, source: 'manual' });
    await pullProfileFromServer();
    expect(await getMacroTargets()).toEqual(target);
  } finally { global.fetch = originalFetch; }
});
