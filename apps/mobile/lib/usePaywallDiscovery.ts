import { useEffect, useState } from 'react';
import { getPaywallIntent, type PaywallIntent } from './paywallIntent';
import { getOnboardingData } from './onboardingStorage';
import { getMacroTargets } from './macroStorage';
import { fetchGuidedPreview } from './guidedPreview';

export type PaywallRestaurant = { id: string; name: string; photoUrl?: string };
export interface PaywallDiscovery {
  selected?: PaywallRestaurant;
  nearby: PaywallRestaurant[];
  additionalCount?: number;
}
const EMPTY_DISCOVERY: PaywallDiscovery = { nearby: [] };
const photo = (r: PaywallRestaurant): PaywallRestaurant => ({ id: r.id, name: r.name, photoUrl: r.photoUrl });
function selectedRestaurant(intent: PaywallIntent | null): PaywallRestaurant | undefined {
  return intent?.restaurantId && intent.restaurantName
    ? { id: intent.restaurantId, name: intent.restaurantName, photoUrl: intent.photoUrl } : undefined;
}

export function usePaywallDiscovery(focused: boolean): PaywallDiscovery {
  const [value, setValue] = useState<PaywallDiscovery>(EMPTY_DISCOVERY);
  useEffect(() => {
    // The next focus can belong to another selection or account. Clear both
    // the image and numerical proof before reads that may reject.
    setValue(EMPTY_DISCOVERY);
    if (!focused) return;
    let live = true;
    const controller = new AbortController();
    void (async () => {
      const [intent, data, savedTargets] = await Promise.all([getPaywallIntent(), getOnboardingData(), getMacroTargets()]);
      if (!live) return;
      const selected = selectedRestaurant(intent);
      setValue({ selected, nearby: intent?.nearbyRestaurants ?? [] });
      const area = intent?.area ?? (data.area && (!intent?.areaName || data.area.name === intent.areaName) ? data.area : undefined);
      if (!area) return;
      const query = intent?.query ?? (data.previewArea === `${area.lat}:${area.lng}` ? data.previewCraving ?? '' : '');
      const preview = await fetchGuidedPreview(area, query, intent?.targets ?? savedTargets, { selectedItemId: intent?.menuItemId, signal: controller.signal });
      if (!live) return;
      const matching = preview.meta.goalMatch;
      setValue({
        selected,
        nearby: preview.data.filter(r => r.id !== selected?.id).map(photo).slice(0, 2),
        // A selected dish must still be in the server's visible qualifying set.
        // Otherwise its total may include that dish and cannot prove 'more'.
        additionalCount: intent?.menuItemId && !matching?.selectedItemMatches ? undefined : matching?.additionalDishCount,
      });
    })().catch(() => { /* Only a selection read during this focus may survive a failed search. */ });
    return () => { live = false; controller.abort(); };
  }, [focused]);
  return focused ? value : EMPTY_DISCOVERY;
}
