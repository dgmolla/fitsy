import AsyncStorage from '@react-native-async-storage/async-storage';
import { MACRO_TARGETS_KEY, type StoredMacroTargets, type MacroTargetSource, type MacroTargetMode } from './macroStorage';
import { mutateTargets } from './macroStorageQueue';
import { normalizeCompleteTarget } from './macroEnergy';
import { supabase } from './supabase';
const currentUserId = async () => (await supabase.auth.getSession()).data.session?.user?.id ?? null;

/** Sync intent and settled grams are one native record, surviving interrupted API queuing. */
export async function getPendingMacroTarget(userId: string): Promise<{ targets: StoredMacroTargets;
  source: MacroTargetSource; key: string; raw: string } | null> {
  if (await currentUserId() !== userId) return null;
  for (const key of [MACRO_TARGETS_KEY, `${MACRO_TARGETS_KEY}:${userId}`]) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    const record = JSON.parse(raw) as StoredMacroTargets & { _owner?: string; _pendingSync?: boolean;
      _source?: MacroTargetSource; _mode?: MacroTargetMode };
    if (record._owner !== userId || record._mode !== 'complete') continue;
    // An active allocation supersedes its older account archive, including
    // after the active allocation's intent has already been acknowledged.
    if (!record._pendingSync) return null;
    const snapshot = { targets: normalizeCompleteTarget({ protein: record.protein,
      carbs: record.carbs, fat: record.fat, calories: record.calories }) };
    if (await currentUserId() === userId)
      return { targets: snapshot.targets, source: record._source ?? 'manual', key, raw };
  }
  return null;
}

/** A delayed acknowledgement must never clear a newer target's intent. */
export function acknowledgePendingMacroTarget(pending: { key: string; raw: string }): Promise<void> {
  return mutateTargets(async () => {
    if (await AsyncStorage.getItem(pending.key) !== pending.raw) return;
    const record = JSON.parse(pending.raw) as { _pendingSync?: boolean };
    delete record._pendingSync;
    await AsyncStorage.setItem(pending.key, JSON.stringify(record));
  });
}
