import AsyncStorage from '@react-native-async-storage/async-storage';
import { macroCalories, normalizeCompleteTarget, parseTarget } from './macroEnergy';
import { supabase } from './supabase';
export const MACRO_TARGETS_KEY = '@fitsy/macro_targets';
export const SEARCH_MACRO_TARGETS_KEY = '@fitsy/search_macro_targets';
const ownedTargetKey = (userId: string) => `${MACRO_TARGETS_KEY}:${userId}`;
const LEGACY_UNOWNED_KEY = '@fitsy/legacy_unowned_macro_targets';
async function searchKey(): Promise<string> {
  const userId = await currentUserId();
  return userId ? `${SEARCH_MACRO_TARGETS_KEY}:${userId}` : SEARCH_MACRO_TARGETS_KEY;
}
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
export interface StoredMacroTargets {
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
}
export type MacroTargetMode = 'complete' | 'search';
export type MacroTargetSource = 'automatic' | 'manual';
export interface MacroTargetSnapshot { targets: StoredMacroTargets; mode: MacroTargetMode }
function isLegacyGeneratedShape(targets: StoredMacroTargets): boolean {
  const calories = parseTarget(targets.calories);
  const protein = parseTarget(targets.protein);
  const carbs = parseTarget(targets.carbs);
  const fat = parseTarget(targets.fat);
  if (calories === null || protein === null || carbs === null || fat === null) return false;
  // Older automatic targets rounded the meal calories and each gram field
  // separately. Identify that exact historical output before interpreting a
  // mismatch as a user-chosen, independent discovery constraint.
  const ratios: readonly (readonly [number, number, number])[] = [
    [0.25, 0.45, 0.30], [0.20, 0.55, 0.25], [0.20, 0.50, 0.30],
  ];
  const mealSplit = 3.5;
  const firstDaily = Math.max(1200, Math.ceil((calories - 0.5) * mealSplit));
  const lastDaily = Math.min(3500, Math.ceil((calories + 0.5) * mealSplit) - 1);
  for (let daily = firstDaily; daily <= lastDaily; daily++) {
    if (ratios.some(([p, c, f]) =>
      Math.round(daily * p / 4 / mealSplit) === protein
      && Math.round(daily * c / 4 / mealSplit) === carbs
      && Math.round(daily * f / 9 / mealSplit) === fat)) return true;
  }
  // The old macro-setup picker snapped daily grams to 5/5/2 before dividing
  // each field by 3.5. Its calorie field came from those daily snapped grams.
  const snap = (value: number, step: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(value / step) * step));
  for (let daily = 1200; daily <= 3500; daily += 25) {
    if (ratios.some(([p, c, f]) => {
      const dailyProtein = snap(daily * p / 4, 5, 50, 300);
      const dailyCarbs = snap(daily * c / 4, 5, 50, 500);
      const dailyFat = snap(daily * f / 9, 2, 20, 150);
      return protein === Math.round(dailyProtein / mealSplit)
        && carbs === Math.round(dailyCarbs / mealSplit)
        && fat === Math.round(dailyFat / mealSplit)
        && calories === Math.round(macroCalories({ protein: dailyProtein, carbs: dailyCarbs,
          fat: dailyFat }) / mealSplit);
    })) return true;
  }
  return false;
}
function legacyIndependentFilter(targets: StoredMacroTargets, generated: boolean): boolean {
  const calories = parseTarget(targets.calories);
  const protein = parseTarget(targets.protein);
  const carbs = parseTarget(targets.carbs);
  const fat = parseTarget(targets.fat);
  if (calories === null || protein === null || carbs === null || fat === null) return false;
  // Legacy discovery stored independently entered constraints in this key.
  // Without an explicit mode, even a small mismatch may be intentional.
  return !generated && calories !== macroCalories({ protein, carbs, fat });
}

async function readSnapshot(key: string): Promise<MacroTargetSnapshot | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as StoredMacroTargets & { _mode?: MacroTargetMode; _owner?: string | null;
      _source?: MacroTargetSource };
    const { _mode, _owner, _source, ...targets } = record;
    if (key === MACRO_TARGETS_KEY && _owner === undefined && await currentUserId()) {
      await AsyncStorage.setItem(LEGACY_UNOWNED_KEY, raw);
      await AsyncStorage.removeItem(MACRO_TARGETS_KEY);
      return null;
    }
    if (key === MACRO_TARGETS_KEY && _owner && _owner !== await currentUserId()) return null;
    const generated = _mode === undefined && isLegacyGeneratedShape(targets);
    const parsed = [targets.protein, targets.carbs, targets.fat].map(parseTarget);
    const completeZero = parsed.every(value => value !== null)
      && parsed.some(value => value === 0)
      && parseTarget(targets.calories) === macroCalories({ protein: parsed[0]!, carbs: parsed[1]!, fat: parsed[2]! });
    const legacyPartial = _mode === undefined && (parseTarget(targets.calories) === null
      || (!completeZero && parsed.some(value => value === null || value === 0)));
    const mode = _mode === 'search' || legacyPartial ||
      (_mode === undefined && legacyIndependentFilter(targets, generated)) ? 'search' : 'complete';
    // Legacy values have no provenance. A manual target can exactly match an
    // old generated result, so preserve its grams and only repair energy.
    return { targets: mode === 'complete' ? normalizeCompleteTarget(targets) : targets, mode };
  } catch {
    return null;
  }
}

export async function getMacroTargetSnapshot(): Promise<MacroTargetSnapshot | null> {
  const snapshot = await readSnapshot(MACRO_TARGETS_KEY);
  // Archives are recovery data, not an active allocation or a pending edit.
  // Only profile reconciliation may restore them after checking the server.
  return snapshot?.mode === 'complete' ? snapshot : null;
}

export async function getArchivedMacroTarget(userId: string): Promise<(MacroTargetSnapshot & {
  source: MacroTargetSource }) | null> {
  if (await currentUserId() !== userId) return null;
  const archived = await readSnapshot(ownedTargetKey(userId));
  if (archived?.mode !== 'complete') return null;
  let source: MacroTargetSource = 'manual';
  try {
    const raw = await AsyncStorage.getItem(ownedTargetKey(userId));
    if (raw && (JSON.parse(raw) as { _source?: MacroTargetSource })._source === 'automatic')
      source = 'automatic';
  } catch { /* A missing source tag is treated as a manual target. */ }
  return await currentUserId() === userId ? { ...archived, source } : null;
}

export async function clearArchivedMacroTarget(userId: string): Promise<void> {
  await AsyncStorage.removeItem(ownedTargetKey(userId));
}

export async function getDiscoveryMacroTargetSnapshot(): Promise<MacroTargetSnapshot | null> {
  const userId = await currentUserId();
  const key = userId ? `${SEARCH_MACRO_TARGETS_KEY}:${userId}` : SEARCH_MACRO_TARGETS_KEY;
  const scoped = await readSnapshot(key);
  if (await currentUserId() !== userId) return null;
  if (scoped) return scoped;
  // Claim an unscoped filter written by an older client once, then remove it
  // so a later account on the same device cannot inherit it.
  if (key !== SEARCH_MACRO_TARGETS_KEY) {
    const legacy = await readSnapshot(SEARCH_MACRO_TARGETS_KEY);
    if (legacy) {
      if (await currentUserId() !== userId) return null;
      await AsyncStorage.setItem(key, JSON.stringify({ ...legacy.targets, _mode: 'search' }));
      await AsyncStorage.removeItem(SEARCH_MACRO_TARGETS_KEY);
      return { ...legacy, mode: 'search' };
    }
  }
  const legacyOrComplete = await readSnapshot(MACRO_TARGETS_KEY);
  if (await currentUserId() !== userId) return null;
  return legacyOrComplete ?? getMacroTargetSnapshot();
}

/** An explicit anonymous complete target should follow its owner at sign-in. */
export async function getAnonymousCompleteTarget(): Promise<{ targets: StoredMacroTargets;
  source: MacroTargetSource } | null> {
  const raw = await AsyncStorage.getItem(MACRO_TARGETS_KEY);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as StoredMacroTargets & { _mode?: MacroTargetMode;
      _owner?: string | null; _source?: MacroTargetSource };
    if (record._mode !== 'complete' || record._owner !== null) return null;
    const { _mode, _owner, _source, ...targets } = record;
    return { targets: normalizeCompleteTarget(targets), source: _source ?? 'manual' };
  } catch { return null; }
}

export async function getMacroTargets(): Promise<StoredMacroTargets | null> {
  return (await getMacroTargetSnapshot())?.targets ?? null;
}

/** Keep ownerless pre-upgrade data until a person explicitly restores it. */
export async function getQuarantinedLegacyTarget(): Promise<MacroTargetSnapshot | null> {
  if (!await currentUserId()) return null;
  await readSnapshot(MACRO_TARGETS_KEY);
  return readSnapshot(LEGACY_UNOWNED_KEY);
}

export async function restoreQuarantinedLegacyTarget(expectedUserId?: string): Promise<MacroTargetSnapshot | null> {
  const userId = await currentUserId();
  if (!userId || (expectedUserId !== undefined && userId !== expectedUserId)) return null;
  const snapshot = await getQuarantinedLegacyTarget();
  if (!snapshot || await currentUserId() !== userId) return null;
  await saveMacroTargets(snapshot.targets, snapshot.mode, 'manual', userId);
  if (await currentUserId() !== userId) return null;
  await AsyncStorage.removeItem(LEGACY_UNOWNED_KEY);
  return snapshot;
}

export async function getMacroTargetSource(): Promise<MacroTargetSource> {
  const userId = await currentUserId();
  const raw = await AsyncStorage.getItem(MACRO_TARGETS_KEY);
  if (await currentUserId() !== userId) return 'manual';
  if (raw) try {
    const saved = JSON.parse(raw) as { _source?: MacroTargetSource; _owner?: string | null };
    if (!saved._owner || saved._owner === userId)
      return saved._source === 'automatic' ? 'automatic' : 'manual';
  } catch { /* Fall back to the current account's retained target. */ }
  return userId ? (await getArchivedMacroTarget(userId))?.source ?? 'manual' : 'manual';
}

/** A saved partial search filter is enough to resume a completed account. */
export async function hasSavedMealTargets(): Promise<boolean> {
  const complete = (await getMacroTargetSnapshot())?.targets;
  if (complete && [complete.protein, complete.carbs, complete.fat, complete.calories]
    .every(value => parseTarget(value) !== null) && parseTarget(complete.calories)! > 0) return true;
  const search = (await getDiscoveryMacroTargetSnapshot())?.targets;
  if (search && await AsyncStorage.getItem(await searchKey())) return true;
  return !!search && [search.protein, search.carbs, search.fat, search.calories]
    .some(value => (parseTarget(value) ?? 0) > 0);
}

export async function getDiscoveryMacroTargets(): Promise<StoredMacroTargets | null> {
  return (await getDiscoveryMacroTargetSnapshot())?.targets ?? null;
}

export async function saveMacroTargets(targets: StoredMacroTargets, mode: MacroTargetMode = 'complete',
  source: MacroTargetSource = 'manual', expectedUserId?: string | null): Promise<void> {
  if (expectedUserId !== undefined && await currentUserId() !== expectedUserId) return;
  const settled = mode === 'complete' ? normalizeCompleteTarget(targets) : targets;
  const owner = expectedUserId !== undefined ? expectedUserId : await currentUserId();
  const key = owner ? `${SEARCH_MACRO_TARGETS_KEY}:${owner}` : SEARCH_MACRO_TARGETS_KEY;
  if (mode === 'complete' && !(await AsyncStorage.getItem(key))) {
    const legacySearch = await readSnapshot(MACRO_TARGETS_KEY);
    if (legacySearch?.mode === 'search') {
      await AsyncStorage.setItem(key,
        JSON.stringify({ ...legacySearch.targets, _mode: 'search' }));
    }
  }
  if (expectedUserId !== undefined && await currentUserId() !== expectedUserId) return;
  await AsyncStorage.setItem(mode === 'search' ? key : MACRO_TARGETS_KEY,
    JSON.stringify({ ...settled, _mode: mode,
      ...(mode === 'complete' ? { _owner: owner, _source: source } : {}) }));
}

/** Explicitly linking a discovery filter replaces its independent search snapshot. */
export async function saveDiscoveryMacroTargets(targets: StoredMacroTargets, mode: MacroTargetMode): Promise<void> {
  const requestedOwner = currentUserId();
  const next = discoverySaveQueue.then(async () => {
    const originalOwner = await requestedOwner;
    const activeOwner = await currentUserId();
    // An anonymous preview filter follows the user into their first account.
    // A signed-in account's filter never transfers to a different account.
    if (originalOwner && activeOwner !== originalOwner) return;
    const owner = originalOwner ?? activeOwner;
    const key = owner ? `${SEARCH_MACRO_TARGETS_KEY}:${owner}` : SEARCH_MACRO_TARGETS_KEY;
    await saveMacroTargets(targets, mode, 'manual', owner);
    if (await currentUserId() !== owner) return;
    if (!originalOwner && owner) await AsyncStorage.removeItem(SEARCH_MACRO_TARGETS_KEY);
    if (mode === 'complete') await AsyncStorage.removeItem(key);
  });
  discoverySaveQueue = next.catch(() => {});
  await next;
}

let discoverySaveQueue: Promise<void> = Promise.resolve();

export async function clearMacroTargets(): Promise<void> {
  await AsyncStorage.removeItem(MACRO_TARGETS_KEY);
  await AsyncStorage.removeItem(await searchKey());
  await AsyncStorage.removeItem(SEARCH_MACRO_TARGETS_KEY);
}

/** Clear active local targets when the account leaves this device. */
export async function clearActiveMacroTargets(): Promise<void> {
  await AsyncStorage.removeItem(MACRO_TARGETS_KEY);
  await AsyncStorage.removeItem(SEARCH_MACRO_TARGETS_KEY);
}

/** Preserve an unsynced complete target under its account before sign-out. */
export async function archiveActiveMacroTargets(userId: string | null, forget = false): Promise<void> {
  if (!userId) return;
  if (forget) {
    await clearArchivedMacroTarget(userId);
    await AsyncStorage.removeItem(`${SEARCH_MACRO_TARGETS_KEY}:${userId}`);
    return;
  }
  const raw = await AsyncStorage.getItem(MACRO_TARGETS_KEY);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as { _owner?: string | null; _mode?: MacroTargetMode };
    if (record._mode === 'complete' && (record._owner === userId || record._owner === null))
      await AsyncStorage.setItem(ownedTargetKey(userId), raw);
  } catch { /* Invalid local data cannot be replayed. */ }
}
