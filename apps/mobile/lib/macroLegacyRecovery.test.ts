/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDiscoveryMacroTargetSnapshot, getLegacyMacroRecovery, getMacroTargets,
  restoreLegacyMacroTarget, saveMacroTargets, MACRO_TARGETS_KEY, SEARCH_MACRO_TARGETS_KEY,
  type MacroTargetMode } from './macroStorage';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockUserId: string | null = null;
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: {
    session: mockUserId ? { user: { id: mockUserId } } : null,
  } }) } }),
}));
const legacy = { protein: '50', carbs: '65', fat: '20', calories: '600' };
const quarantineKey = '@fitsy/legacy_unowned_macro_targets';
beforeEach(async () => { mockUserId = null; await AsyncStorage.clear(); });
afterEach(() => { mockUserId = null; jest.restoreAllMocks(); });

describe.each([null, 'account-a'])('legacy recovery for owner %s', owner => {
  it.each<MacroTargetMode>(['complete', 'search'])('persists the explicit %s choice across reopen and account switches', async mode => {
    mockUserId = owner;
    await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
    const recovery = (await getLegacyMacroRecovery())!;
    expect(recovery.snapshot).toEqual({ targets: legacy, mode: 'search', needsModeChoice: true });
    expect(await getMacroTargets()).toBeNull();
    const targets = { ...legacy, calories: mode === 'complete' ? '640' : '600' };
    expect(await restoreLegacyMacroTarget(recovery, mode)).toEqual({ targets, mode });
    expect(await getMacroTargets()).toEqual(mode === 'complete' ? targets : null);
    expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets, mode });
    expect(await getLegacyMacroRecovery()).toBeNull();
    const key = mode === 'complete' ? MACRO_TARGETS_KEY
      : `${SEARCH_MACRO_TARGETS_KEY}${owner ? `:${owner}` : ''}`;
    expect(JSON.parse((await AsyncStorage.getItem(key))!)).toMatchObject({ ...targets, _mode: mode });
    if (owner) {
      mockUserId = 'account-b';
      expect(await getMacroTargets()).toBeNull();
      expect(await getDiscoveryMacroTargetSnapshot()).toBeNull();
      mockUserId = owner;
      expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets, mode });
    }
  });
});

it.each<MacroTargetMode>(['complete', 'search'])('retains explicit %s provenance even when calories mismatch', async mode => {
  mockUserId = 'account-a';
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify({ ...legacy, _mode: mode }));
  const recovery = (await getLegacyMacroRecovery())!;
  expect(recovery.snapshot.needsModeChoice).toBeUndefined();
  expect(recovery.snapshot.mode).toBe(mode);
  expect(await restoreLegacyMacroTarget(recovery, mode === 'search' ? 'complete' : 'search')).toBeNull();
  await restoreLegacyMacroTarget(recovery, mode);
  expect((await getDiscoveryMacroTargetSnapshot())?.targets.calories).toBe(mode === 'complete' ? '640' : '600');
});

it('uses the dedicated legacy search key as filter provenance', async () => {
  await AsyncStorage.setItem(SEARCH_MACRO_TARGETS_KEY, JSON.stringify(legacy));
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: legacy, mode: 'search' });
  expect(await getLegacyMacroRecovery()).toBeNull();
});

it('keeps a separate intentional filter when recovering complete profile targets', async () => {
  mockUserId = 'account-a';
  const filter = { ...legacy, protein: '90', calories: '700' };
  await saveMacroTargets(filter, 'search');
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  await restoreLegacyMacroTarget((await getLegacyMacroRecovery())!, 'complete');
  expect(await getMacroTargets()).toEqual({ ...legacy, calories: '640' });
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: filter, mode: 'search' });
});

it('retains unresolved legacy grams when a new allocation and separate filter are saved', async () => {
  const filter = { ...legacy, protein: '90', calories: '700' };
  await saveMacroTargets(filter, 'search');
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  await saveMacroTargets({ ...legacy, protein: '60' });
  expect(await AsyncStorage.getItem(quarantineKey)).toBe(JSON.stringify(legacy));
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: filter, mode: 'search' });
  mockUserId = 'account-a';
  const recovery = (await getLegacyMacroRecovery())!;
  expect(recovery.snapshot.needsModeChoice).toBe(true);
  await restoreLegacyMacroTarget(recovery, 'complete');
  expect(await getMacroTargets()).toEqual({ ...legacy, calories: '640' });
});

it('refuses a stale choice after a new profile target is saved', async () => {
  mockUserId = 'account-a';
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  const recovery = (await getLegacyMacroRecovery())!;
  const newer = { ...legacy, protein: '60', calories: '680' };
  await saveMacroTargets(newer);
  expect(await restoreLegacyMacroTarget(recovery, 'complete')).toBeNull();
  expect(await getMacroTargets()).toEqual(newer);
  expect(await AsyncStorage.getItem(quarantineKey)).toBe(recovery.raw);
});

it('refuses a stale choice after the displayed legacy data changes', async () => {
  mockUserId = 'account-a';
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  const recovery = (await getLegacyMacroRecovery())!;
  const replacement = JSON.stringify({ ...legacy, protein: '90' });
  await AsyncStorage.setItem(quarantineKey, replacement);
  expect(await restoreLegacyMacroTarget(recovery, 'complete')).toBeNull();
  expect(await getMacroTargets()).toBeNull();
  expect(await AsyncStorage.getItem(quarantineKey)).toBe(replacement);
});

it.each([null, 'account-a'])('refuses a choice opened by %s after the account changes', async owner => {
  mockUserId = owner;
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  const recovery = (await getLegacyMacroRecovery())!;
  mockUserId = 'account-b';
  expect(await restoreLegacyMacroTarget(recovery, 'search')).toBeNull();
  expect(await getDiscoveryMacroTargetSnapshot()).toBeNull();
  expect(await AsyncStorage.getItem(quarantineKey)).toBe(recovery.raw);
});

it('consumes a legacy record once when two choices race', async () => {
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  const recovery = (await getLegacyMacroRecovery())!;
  const [complete, search] = await Promise.all([
    restoreLegacyMacroTarget(recovery, 'complete'), restoreLegacyMacroTarget(recovery, 'search'),
  ]);
  expect(complete?.targets.calories).toBe('640');
  expect(search).toBeNull();
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: { ...legacy, calories: '640' }, mode: 'complete' });
});

it('retains anonymous recovery data if sign-in interrupts the native complete-target write', async () => {
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify(legacy));
  const recovery = (await getLegacyMacroRecovery())!;
  const setItem = AsyncStorage.setItem;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, raw) => {
    await setItem(key, raw);
    mockUserId = 'account-b';
  });
  expect(await restoreLegacyMacroTarget(recovery, 'complete')).toBeNull();
  expect(await getMacroTargets()).toBeNull();
  expect((await getLegacyMacroRecovery())?.raw).toBe(recovery.raw);
});

it('does not clamp manually edited protein when recovering complete targets', async () => {
  await AsyncStorage.setItem(MACRO_TARGETS_KEY, JSON.stringify({ ...legacy, protein: '150' }));
  await restoreLegacyMacroTarget((await getLegacyMacroRecovery())!, 'complete');
  expect(await getMacroTargets()).toEqual({ ...legacy, protein: '150', calories: '1040' });
});
