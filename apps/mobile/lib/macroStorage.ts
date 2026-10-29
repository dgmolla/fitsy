import * as Crypto from 'expo-crypto';
import { mutateTargets } from './macroStorageQueue';
import { isLegacyGeneratedShape, legacyIndependentFilter } from './legacyMacroTarget';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { forgetLegacyMacroRecords, quarantineLegacyMacroRecord } from './macroLegacyStorage';
import { macroCalories, normalizeCompleteTarget, parseTarget } from './macroEnergy';
import { supabase } from './supabase';
import { notifyWidgetUpdates } from './widgetEvents';
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
async function readSnapshot(key: string): Promise<MacroTargetSnapshot | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as StoredMacroTargets & { _mode?: MacroTargetMode; _owner?: string | null;
      _source?: MacroTargetSource; _pendingSync?: boolean; _syncId?: string };
    const { _mode, _owner, _source, _pendingSync, _syncId, ...targets } = record;
    if (key === MACRO_TARGETS_KEY && _owner === undefined && await currentUserId()) {
      await quarantineLegacyMacroRecord(raw);
      return null;
    }
    // Explicit anonymous edits stay available to the sign-in claim path, but
    // cannot become an account target before profile reconciliation finishes.
    if (key === MACRO_TARGETS_KEY && _owner === null && await currentUserId()) return null;
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
      _owner?: string | null; _source?: MacroTargetSource; _pendingSync?: boolean; _syncId?: string };
    if (record._mode !== 'complete' || record._owner !== null) return null;
    const { _mode, _owner, _source, _pendingSync, _syncId, ...targets } = record;
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
  if (!await saveMacroTargets(snapshot.targets, snapshot.mode, 'manual', userId)) return null;
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

/** Capture ownership at invocation, including ordinary UI saves. */
export function saveMacroTargets(targets: StoredMacroTargets, mode: MacroTargetMode = 'complete',
  source: MacroTargetSource = 'manual', expectedUserId?: string | null, pendingSync = true, expectedRecord?: string | null): Promise<boolean> {
  const requestedOwner = currentUserId();
  const settled = mode === 'complete' ? normalizeCompleteTarget(targets) : { ...targets };
  return mutateTargets(async () => {
    const owner = await requestedOwner;
    if ((expectedUserId !== undefined && owner !== expectedUserId) || await currentUserId() !== owner) return false;
    if (expectedRecord !== undefined && await AsyncStorage.getItem(MACRO_TARGETS_KEY) !== expectedRecord) return false;
    const key = owner ? `${SEARCH_MACRO_TARGETS_KEY}:${owner}` : SEARCH_MACRO_TARGETS_KEY;
    if (mode === 'complete' && !(await AsyncStorage.getItem(key))) {
      const legacySearch = await readSnapshot(MACRO_TARGETS_KEY);
      if (await currentUserId() !== owner) return false;
      if (legacySearch?.mode === 'search') {
        await AsyncStorage.setItem(key,
          JSON.stringify({ ...legacySearch.targets, _mode: 'search' }));
      }
    }
    if (await currentUserId() !== owner) return false;
    const record = JSON.stringify({ ...settled, _mode: mode,
      ...(mode === 'complete' ? { _owner: owner, _source: source, ...(owner && pendingSync ? { _pendingSync: true, _syncId: Crypto.randomUUID() } : {}) } : {}) });
    await AsyncStorage.setItem(mode === 'search' ? key : MACRO_TARGETS_KEY, record);
    // Account cleanup and later saves wait for this write. If auth changes
    // during native IO, remove only this obsolete shared active record.
    if (await currentUserId() !== owner) {
      if (mode === 'complete' && await AsyncStorage.getItem(MACRO_TARGETS_KEY) === record)
        await AsyncStorage.removeItem(MACRO_TARGETS_KEY);
      return false;
    }
    notifyWidgetUpdates();
    return true;
  });
}

/** Explicitly linking a discovery filter replaces its independent search snapshot. */
export async function saveDiscoveryMacroTargets(targets: StoredMacroTargets, mode: MacroTargetMode): Promise<boolean> {
  const requestedOwner = currentUserId();
  const next = discoverySaveQueue.then(async () => {
    const originalOwner = await requestedOwner;
    const activeOwner = await currentUserId();
    // An anonymous preview filter follows the user into their first account.
    // A signed-in account's filter never transfers to a different account.
    if (originalOwner && activeOwner !== originalOwner) return false;
    const owner = originalOwner ?? activeOwner;
    const key = owner ? `${SEARCH_MACRO_TARGETS_KEY}:${owner}` : SEARCH_MACRO_TARGETS_KEY;
    if (!await saveMacroTargets(targets, mode, 'manual', owner)) return false;
    if (await currentUserId() !== owner) return false;
    if (!originalOwner && owner) await AsyncStorage.removeItem(SEARCH_MACRO_TARGETS_KEY);
    if (mode === 'complete') await AsyncStorage.removeItem(key);
    notifyWidgetUpdates();
    return await currentUserId() === owner;
  });
  discoverySaveQueue = next.then(() => {}, () => {});
  return next;
}

let discoverySaveQueue: Promise<void> = Promise.resolve();

async function performClearMacroTargets(): Promise<void> {
  await AsyncStorage.removeItem(MACRO_TARGETS_KEY);
  await AsyncStorage.removeItem(await searchKey());
  await AsyncStorage.removeItem(SEARCH_MACRO_TARGETS_KEY);
}

/** Clear active local targets when the account leaves this device. */
async function performClearActiveMacroTargets(owner: string | null): Promise<void> {
  const raw = await AsyncStorage.getItem(MACRO_TARGETS_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw) as { _owner?: string | null };
      if (saved._owner === undefined || saved._owner === null || saved._owner === owner)
        await AsyncStorage.removeItem(MACRO_TARGETS_KEY);
    } catch { await AsyncStorage.removeItem(MACRO_TARGETS_KEY); }
  }
  await AsyncStorage.removeItem(SEARCH_MACRO_TARGETS_KEY);
}

/** Preserve an unsynced complete target under its account before sign-out. */
async function performArchiveActiveMacroTargets(userId: string | null, forget: boolean): Promise<void> {
  if (forget) await forgetLegacyMacroRecords();
  if (!userId) return;
  if (forget) {
    await clearArchivedMacroTarget(userId);
    await AsyncStorage.removeItem(`${SEARCH_MACRO_TARGETS_KEY}:${userId}`);
    return;
  }
  const raw = await AsyncStorage.getItem(MACRO_TARGETS_KEY);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as { _owner?: string | null; _mode?: MacroTargetMode; _source?: MacroTargetSource;
      _pendingSync?: boolean; _syncId?: string };
    if (record._mode === 'complete' && (record._owner === userId || record._owner === null))
      await AsyncStorage.setItem(ownedTargetKey(userId), record._owner === null && record._source !== 'automatic'
        ? JSON.stringify({ ...record, _owner: userId, _pendingSync: true, _syncId: Crypto.randomUUID() }) : raw);
  } catch { /* Invalid local data cannot be replayed. */ }
}

export function clearMacroTargets(): Promise<void> {
  return mutateTargets(performClearMacroTargets);
}

export function clearActiveMacroTargets(expectedOwner?: string | null): Promise<void> {
  const owner = expectedOwner === undefined ? currentUserId() : Promise.resolve(expectedOwner);
  return mutateTargets(async () => performClearActiveMacroTargets(await owner));
}

export function archiveActiveMacroTargets(userId: string | null, forget = false): Promise<void> {
  return mutateTargets(() => performArchiveActiveMacroTargets(userId, forget));
}
