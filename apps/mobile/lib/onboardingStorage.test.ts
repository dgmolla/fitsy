let mockSession: { user: { id: string; is_anonymous?: boolean } } | null = null;
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: mockSession } }) } }),
}));
import { claimAnonymousOnboardingData, getOnboardingData, saveOnboardingField } from './onboardingStorage';

const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => { store[key] = value; },
  },
}));
beforeEach(() => { for (const key of Object.keys(store)) delete store[key]; mockSession = null; });

test('rapid goal and area updates preserve both choices and the existing profile', async () => {
  await saveOnboardingField('weightKg', 75);
  const area = { name: 'DTLA', lat: 34.0407, lng: -118.2468, source: 'manual' as const };
  await Promise.all([saveOnboardingField('goal', 'build_muscle'), saveOnboardingField('area', area), saveOnboardingField('targetMode', 'estimate')]);
  expect(await getOnboardingData()).toEqual({ weightKg: 75, goal: 'build_muscle', area, targetMode: 'estimate' });
});

test('an anonymous session (#801) saves as unowned, same as no session, and claims onto the real account at sign-in', async () => {
  mockSession = { user: { id: 'anon-device-1', is_anonymous: true } };
  await saveOnboardingField('goal', 'lose_fat');
  mockSession = { user: { id: 'real-user-1' } };
  // Not yet claimed - a different account must not see the anonymous edit.
  expect(await getOnboardingData()).toEqual({});
  expect(await claimAnonymousOnboardingData('real-user-1')).toBe(true);
  expect(await getOnboardingData()).toEqual({ goal: 'lose_fat' });
});
