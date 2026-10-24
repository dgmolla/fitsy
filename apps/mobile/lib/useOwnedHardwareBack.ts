import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** Native Back must use the same cleanup as the screen's visible Back. */
export function useOwnedHardwareBack(onBack?: () => void) {
  useFocusEffect(useCallback(() => {
    if (!onBack) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => listener.remove();
  }, [onBack]));
  return onBack;
}
