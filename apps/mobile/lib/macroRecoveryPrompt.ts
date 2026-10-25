import { Alert } from 'react-native';
import { normalizeCompleteTarget } from './macroEnergy';
import { getLegacyMacroRecovery, restoreLegacyMacroTarget,
  type MacroTargetMode, type MacroTargetSnapshot } from './macroStorage';
import { queueSavedProfileToServer, deliverQueuedProfile } from './profileSync';

/** Profile and anonymous discovery share the same account-bound recovery path. */
export async function offerLegacyMacroRecovery(ambiguousOnly = false): Promise<MacroTargetSnapshot | null> {
  const recovery = await getLegacyMacroRecovery();
  if (!recovery || (ambiguousOnly && !recovery.snapshot.needsModeChoice)) return null;
  const mode = await confirmLegacyMacroRecovery(recovery.snapshot, 'Cancel');
  if (!mode) return null;
  const restored = await restoreLegacyMacroTarget(recovery, mode);
  if (!restored) throw new Error('Account or targets changed while recovering targets');
  if (restored.mode === 'complete') {
    await queueSavedProfileToServer();
    deliverQueuedProfile();
  }
  return restored;
}

export function confirmLegacyMacroRecovery(snapshot: MacroTargetSnapshot,
  cancelText = 'Set new targets'): Promise<MacroTargetMode | null> {
  return new Promise(resolve => {
    if (snapshot.needsModeChoice) {
      const { protein, carbs, fat, calories } = snapshot.targets;
      const complete = normalizeCompleteTarget(snapshot.targets);
      Alert.alert('Recover older targets',
        `This device saved ${protein}g protein, ${carbs}g carbs, ${fat}g fat and ${calories} kcal per meal without a recorded target type. Choose how to restore them here.\n\nComplete meal targets keep your grams and use ${complete.calories} kcal. Independent search filters keep ${calories} kcal and do not change profile targets.`, [
          { text: 'Complete meal targets', onPress: () => resolve('complete') },
          { text: 'Independent search filters', onPress: () => resolve('search') },
          { text: cancelText, style: 'cancel', onPress: () => resolve(null) },
        ], { cancelable: false });
      return;
    }
    const kind = snapshot.mode === 'search' ? 'search filter' : 'meal target';
    Alert.alert(`Restore older ${kind}?`,
      `This device has an older ${kind} without an account label. Restore it to this account?`, [
        { text: cancelText, style: 'cancel', onPress: () => resolve(null) },
        { text: 'Restore', onPress: () => resolve(snapshot.mode) },
      ], { cancelable: false });
  });
}
