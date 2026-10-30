import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getPostHogClient } from './analytics';

/** This experiment cannot be enabled in a production binary or on Android. */
export function useMapSearchFlag(debugOverride = false): boolean {
  const allowed = __DEV__ && Platform.OS === 'ios';
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    try {
      const client = getPostHogClient();
      const update = () => {
        try { setEnabled(client.getFeatureFlag?.('map-search') === true); }
        catch { setEnabled(false); }
      };
      const unsubscribe = client.onFeatureFlags?.(update);
      update();
      return unsubscribe;
    } catch { setEnabled(false); }
  }, [allowed]);
  return allowed && (debugOverride || enabled);
}
