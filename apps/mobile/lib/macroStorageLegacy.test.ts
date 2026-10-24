/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDiscoveryMacroTargetSnapshot, getMacroTargetSnapshot, getMacroTargets,
  saveMacroTargets, saveDiscoveryMacroTargets, MACRO_TARGETS_KEY, SEARCH_MACRO_TARGETS_KEY } from './macroStorage';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

const SAMPLE = { protein: '150', carbs: '200', fat: '67', calories: '2003' };
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

test.each(['', 'invalid'])('legacy calorie value %p retains independent filter semantics', async calories => {
  const legacy = { protein: '40', carbs: '65', fat: '20', calories };
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  expect(await getMacroTargetSnapshot()).toBeNull();
  expect(await getMacroTargets()).toBeNull();
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: legacy, mode: 'search' });
  await saveDiscoveryMacroTargets(legacy, 'search');
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: legacy, mode: 'search' });
});

it('recognizes a legacy generated target and follows the next profile edit in discovery', async () => {
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify({ protein: '43', carbs: '77', fat: '23', calories: '686' }));
  const normalized = { protein: '43', carbs: '77', fat: '23', calories: '687' };
  expect(await getMacroTargets()).toEqual(normalized);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({
    targets: normalized, mode: 'complete',
  });
  await saveMacroTargets(SAMPLE);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: SAMPLE, mode: 'complete' });
});

it('recognizes a legacy snapped picker recommendation before a profile edit', async () => {
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify({ protein: '40', carbs: '71', fat: '21', calories: '636' }));
  const migrated = await getDiscoveryMacroTargetSnapshot();
  expect(migrated?.mode).toBe('complete');
  expect(migrated?.targets).toEqual({ protein: '40', carbs: '71', fat: '21', calories: '633' });
  await saveMacroTargets(SAMPLE);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: SAMPLE, mode: 'complete' });
});

it('preserves ambiguous legacy high protein grams without provenance', async () => {
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify({ calories: '1000', protein: '63', carbs: '113', fat: '33' }));
  const migrated = await getMacroTargets();
  expect(migrated).toEqual({ calories: '1001', protein: '63', carbs: '113', fat: '33' });
  await saveMacroTargets({ calories: '1001', protein: '63', carbs: '113', fat: '33' });
  expect((await getMacroTargets())?.protein).toBe('63');
});

it('retains legacy independent calories for discovery when profile targets settle', async () => {
  const filter = { protein: '40', carbs: '60', fat: '20', calories: '600' };
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(filter));
  expect(await getMacroTargets()).toBeNull();
  expect(await getMacroTargetSnapshot()).toBeNull();
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: filter, mode: 'search' });

  await saveMacroTargets(SAMPLE);
  expect(await getMacroTargets()).toEqual(SAMPLE);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: filter, mode: 'search' });
  expect(JSON.parse((await AsyncStorage.getItem(SEARCH_MACRO_TARGETS_KEY))!)).toEqual({ ...filter, _mode: 'search' });
});

it('preserves a legacy independent calorie constraint even four kcal from macro energy', async () => {
  const filter = { protein: '40', carbs: '64', fat: '20', calories: '600' };
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(filter));
  expect(await getMacroTargets()).toBeNull();
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: filter, mode: 'search' });
  await saveMacroTargets(SAMPLE);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: filter, mode: 'search' });
});

it('keeps unlinked legacy grams with independent calories out of complete targets', async () => {
  const legacy = { protein: '50', carbs: '65', fat: '20', calories: '600' };
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  expect(await getMacroTargets()).toBeNull();
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: legacy, mode: 'search' });
});


it.each([
  { protein: '43', carbs: '79', fat: '10', calories: '573' },
  { protein: '57', carbs: '47', fat: '17', calories: '571' },
  { protein: '50', carbs: '14', fat: '35', calories: '571' },
])('recognizes the retired diet picker output %j as a complete target', async legacy => {
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  const restored = await getMacroTargetSnapshot();
  expect(restored?.mode).toBe('complete');
  expect(restored?.targets).toEqual({ ...legacy,
    calories: String(Number(legacy.protein) * 4 + Number(legacy.carbs) * 4 + Number(legacy.fat) * 9) });
});
