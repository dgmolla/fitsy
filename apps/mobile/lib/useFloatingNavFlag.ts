import { useEffect, useState } from 'react';
import { getPostHogClient } from './analytics';

/** Only the boolean true enables release builds; local captures never change PostHog. */
export function useFloatingNavFlag(debugOverride?: string): boolean {
  const [enabled, setEnabled] = useState(false);
  const [localOverride, setLocalOverride] = useState<boolean>();
  useEffect(() => {
    try {
      const client = getPostHogClient();
      const update = () => {
        try { setEnabled(client.getFeatureFlag?.('floating-nav') === true); }
        catch { setEnabled(false); }
      };
      const unsubscribe = client.onFeatureFlags?.(update);
      update();
      return unsubscribe;
    } catch { setEnabled(false); }
  }, []);
  useEffect(() => {
    // Keep an explicit Debug selection across tab switches, until layout unmount.
    if (__DEV__ && (debugOverride === '1' || debugOverride === '0')) {
      setLocalOverride(debugOverride === '1');
    }
  }, [debugOverride]);
  return __DEV__ && localOverride !== undefined ? localOverride : enabled;
}
