import { useEffect, useState } from 'react';
import { getPostHogClient } from './analytics';

/** Production fails closed; Debug walkthroughs can explicitly opt in locally. */
export function useShuffleFlag(debugOverride = false): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
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
  }, []);
  return (__DEV__ && debugOverride) || enabled;
}
