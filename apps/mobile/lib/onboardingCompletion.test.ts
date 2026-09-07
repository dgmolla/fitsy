/**
 * @jest-environment node
 */
const store: Record<string, string> = {};
const mockPush = jest.fn();
const mockTrack = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => { store[key] = value; },
  },
}));
jest.mock('./profileSync', () => ({ pushProfileToServer: (...a: unknown[]) => mockPush(...a) }));
jest.mock('./onboardingStorage', () => ({
  getOnboardingData: async () => ({ goal: 'lose', activity: 'moderate', weightKg: 70, heightCm: undefined }),
}));
jest.mock('./analytics', () => ({ trackOnboardingCompleted: (...a: unknown[]) => mockTrack(...a) }));

import { DISCOUNT_APPLIED_KEY, ONBOARDING_COMPLETE_KEY, recordOnboardingComplete } from './onboardingCompletion';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mockPush.mockReset();
  mockTrack.mockReset();
});

describe('recordOnboardingComplete', () => {
  it('records once: flag, profile push, one event with the profile shape', async () => {
    expect(await recordOnboardingComplete(false)).toBe(true);
    expect(store[ONBOARDING_COMPLETE_KEY]).toBe('true');
    expect(store[DISCOUNT_APPLIED_KEY]).toBeUndefined();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith({
      goal: 'lose', activity_level: 'moderate', has_weight: true, has_height: false,
    });
  });

  it('marks the discount when the discounted package was bought', async () => {
    await recordOnboardingComplete(true);
    expect(store[DISCOUNT_APPLIED_KEY]).toBe('true');
  });

  it('is idempotent: a second call does nothing and says so', async () => {
    await recordOnboardingComplete(false);
    expect(await recordOnboardingComplete(true)).toBe(false);
    expect(store[DISCOUNT_APPLIED_KEY]).toBeUndefined();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });
});
