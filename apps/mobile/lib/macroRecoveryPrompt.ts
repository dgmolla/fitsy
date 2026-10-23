import { Alert } from 'react-native';
import type { MacroTargetMode } from './macroStorage';

export function confirmLegacyMacroRecovery(mode: MacroTargetMode): Promise<boolean> {
  return new Promise(resolve => {
    const kind = mode === 'search' ? 'search filter' : 'meal target';
    Alert.alert(`Restore older ${kind}?`,
      `This device has an older ${kind} without an account label. Restore it to this account?`, [
        { text: 'Set new targets', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Restore', onPress: () => resolve(true) },
      ], { cancelable: false });
  });
}
