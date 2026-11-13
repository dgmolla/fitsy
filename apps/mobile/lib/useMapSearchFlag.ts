import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { getPostHogClient } from './analytics';

/** iOS production availability is source-controlled; Debug keeps its opt-ins. */
export function useMapSearchFlag(debugOverride = false): boolean {
  const allowed = Platform.OS === 'ios';
  const production = !__DEV__;
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!allowed || production) return;
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
  }, [allowed, production]);
  return allowed && (production || debugOverride || enabled);
}
