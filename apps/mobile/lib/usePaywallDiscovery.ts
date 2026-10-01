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
    const controller = new AbortController();
    setValue({ loading: true });
    const load = async () => {
      const intent = await getPaywallIntent();
      if (!live) return;
      if (intent?.previewResult && intent.previewResult.id === intent.restaurantId) {
        setValue({ selected: intent.previewResult });
        return;
      }
      // The guided public sample carries the same result contract as search.
      // A stored summary from an older app version cannot fabricate meal data.
      const area = intent?.area ?? LOS_ANGELES;
      let response = await fetchGuidedPreview(area, intent?.query ?? '', intent?.targets ?? null, { signal: controller.signal });
      if (!live) return;
      // A saved craving can have no matches. Ask for the unfiltered catalog
      // before falling back to an honest empty state.
      if (!response.data.length && intent?.query) response = await fetchGuidedPreview(area, '', intent.targets ?? null, { signal: controller.signal });
      const selected = response.data.find(row => row.id === intent?.restaurantId) ?? response.data[0];
      if (live) setValue(selected
        ? { selected, catalogFallback: true }
        : EMPTY_DISCOVERY);
    };
    void load().catch(() => { if (live) setValue(EMPTY_DISCOVERY); });
    return () => { live = false; controller.abort(); };
  }, [focused]);
  return focused ? value : EMPTY_DISCOVERY;
}
