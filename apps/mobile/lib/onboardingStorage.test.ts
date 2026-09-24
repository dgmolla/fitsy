import { calculateSuggestedCalories, getOnboardingData, saveOnboardingField } from './onboardingStorage';

const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => { store[key] = value; },
  },
}));
beforeEach(() => { for (const key of Object.keys(store)) delete store[key]; });

test('rapid goal and area updates preserve both choices and the existing profile', async () => {
  await saveOnboardingField('weightKg', 75);
  const area = { name: 'DTLA', lat: 34.0407, lng: -118.2468, source: 'manual' as const };
  await Promise.all([saveOnboardingField('goal', 'build_muscle'), saveOnboardingField('area', area), saveOnboardingField('targetMode', 'estimate')]);
  expect(await getOnboardingData()).toEqual({ weightKg: 75, goal: 'build_muscle', area, targetMode: 'estimate' });
});

// Persisted values can come from older app versions or incomplete profiles.
describe('suggested calories', () => {
  test('performance preserves maintenance energy and legacy maintain remains supported', () => {
    expect(calculateSuggestedCalories({ goal: 'performance' })).toBe(calculateSuggestedCalories({ goal: 'maintain' }));
    expect(calculateSuggestedCalories({ goal: 'maintain' })).toBe(calculateSuggestedCalories({}));
  });

  test.each([NaN, Infinity, -Infinity, 0, -1])('invalid body measurement %s falls back to defaults', (value) => {
    expect(calculateSuggestedCalories({ heightCm: value, weightKg: value })).toBe(calculateSuggestedCalories({}));
  });

  test('invalid birthday uses default age', () => {
    expect(calculateSuggestedCalories({ birthday: 'invalid' })).toBe(calculateSuggestedCalories({}));
  });
});
