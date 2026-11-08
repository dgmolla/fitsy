import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getPostHogClient } from './analytics';

/** Shuffle ships with iOS Discovery; other builds retain the rollout controls. */
export function useShuffleFlag(debugOverride = false): boolean {
  const productionIOS = !__DEV__ && Platform.OS === 'ios';
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (productionIOS) return;
    try {
      const client = getPostHogClient();
      const update = () => {
        try { setEnabled(client.getFeatureFlag?.('shuffle') === true); }
        catch { setEnabled(false); }
      };
      const unsubscribe = client.onFeatureFlags?.(update);
      update();
      return unsubscribe;
    } catch { setEnabled(false); }
  }, [productionIOS]);
  return productionIOS || (__DEV__ && debugOverride) || enabled;
}
