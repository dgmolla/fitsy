/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDiscoveryMacroTargetSnapshot, getMacroTargets, getQuarantinedLegacyTarget,
  hasSavedMealTargets,
  restoreQuarantinedLegacyTarget } from './macroStorage';
import { onboardingEntry } from './onboardingEntry';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockUserId: string | null = null;
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: {
    session: mockUserId ? { user: { id: mockUserId } } : null,
  } }) } }),
}));

afterEach(() => { mockUserId = null; });

it('quarantines an ownerless legacy target across accounts until explicit restore', async () => {
  await AsyncStorage.clear();
  const old = { calories: '600', protein: '50', carbs: '65', fat: '20' };
  await AsyncStorage.setItem('@fitsy/macro_targets', JSON.stringify(old));
  mockUserId = 'account-b';
  expect(await getMacroTargets()).toBeNull();
  expect(await getDiscoveryMacroTargetSnapshot()).toBeNull();
  expect((await getQuarantinedLegacyTarget())?.targets).toEqual(old);
  expect(await hasSavedMealTargets()).toBe(false);
  expect(onboardingEntry({ signedIn: true, purchasesReady: true, entitled: true,
    isLapsed: false, completed: true, declined: false, resume: null,
    hasTargets: await hasSavedMealTargets(), access: 'hard', onboardingPreviewEntry: false,
  })).toBe('/macro-setup');
  mockUserId = 'account-a';
  expect(await getMacroTargets()).toBeNull();
  const restored = await restoreQuarantinedLegacyTarget();
  expect(restored?.mode).toBe('search');
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(old);
  mockUserId = 'account-b';
  expect(await getDiscoveryMacroTargetSnapshot()).toBeNull();
});
