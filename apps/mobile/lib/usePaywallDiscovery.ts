import { useEffect, useState } from 'react';
import { getPaywallIntent } from './paywallIntent';
import { fetchGuidedPreview } from './guidedPreview';
import type { RestaurantResult } from '@fitsy/shared';

export interface PaywallDiscovery { selected?: RestaurantResult; catalogFallback?: boolean; loading?: boolean }
const EMPTY_DISCOVERY: PaywallDiscovery = {};
const LOS_ANGELES = { lat: 34.0522, lng: -118.2437 };

/** Paywall context comes from the user's selection, without issuing a search. */
export function usePaywallDiscovery(focused: boolean): PaywallDiscovery {
  const [value, setValue] = useState<PaywallDiscovery>(EMPTY_DISCOVERY);
  useEffect(() => {
    setValue(EMPTY_DISCOVERY);
    if (!focused) return;
    let live = true;
    setValue({ loading: true });
    void getPaywallIntent().then(async intent => {
      if (!live) return;
      if (intent?.previewResult && intent.previewResult.id === intent.restaurantId) {
        setValue({ selected: intent.previewResult });
        return;
      }
      // The guided public sample carries the same result contract as search.
      // A stored summary from an older app version cannot fabricate meal data.
      const area = intent?.area ?? LOS_ANGELES;
      const response = await fetchGuidedPreview(area, intent?.query ?? '', intent?.targets ?? null);
      const selected = response.data.find(row => row.id === intent?.restaurantId) ?? response.data[0];
      if (live) setValue(selected
        ? { selected, catalogFallback: true }
        : EMPTY_DISCOVERY);
    }).catch(() => { if (live) setValue(EMPTY_DISCOVERY); });
    return () => { live = false; };
  }, [focused]);
  return focused ? value : EMPTY_DISCOVERY;
}
