import { useEffect, useState } from 'react';
import { getPaywallIntent } from './paywallIntent';
import { fetchGuidedPreview } from './guidedPreview';
import type { RestaurantResult } from '@fitsy/shared';

export interface PaywallDiscovery { selected?: RestaurantResult; catalogFallback?: boolean; loading?: boolean }
const EMPTY_DISCOVERY: PaywallDiscovery = {};
const LOS_ANGELES = { lat: 34.0522, lng: -118.2437 };

/** Paywall context comes from the user's selection, without issuing a search. */
export function usePaywallDiscovery(focused: boolean, userId: string | null = null): PaywallDiscovery {
  const [state, setState] = useState<{ userId: string | null; value: PaywallDiscovery } | null>(null);
  useEffect(() => {
    setState(null);
    if (!focused) return;
    let live = true;
    const controller = new AbortController();
    const show = (value: PaywallDiscovery) => { if (live) setState({ userId, value }); };
    show({ loading: true });
    const load = async () => {
      const intent = await getPaywallIntent(userId);
      if (!live) return;
      if (intent?.previewResult && intent.previewResult.id === intent.restaurantId) {
        show({ selected: intent.previewResult });
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
      show(selected
        ? { selected, catalogFallback: true }
        : EMPTY_DISCOVERY);
    };
    void load().catch(() => show(EMPTY_DISCOVERY));
    return () => { live = false; controller.abort(); };
  }, [focused, userId]);
  return focused && state?.userId === userId ? state.value : EMPTY_DISCOVERY;
}
