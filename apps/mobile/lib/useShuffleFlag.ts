import { useEffect, useState } from 'react';
import { getPostHogClient } from './analytics';

/** Fail closed until PostHog enables this boolean flag, including live changes. */
export function useShuffleFlag(): boolean {
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
  return enabled;
}
