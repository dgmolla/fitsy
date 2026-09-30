import { useEffect, useState } from 'react';
import { getPaywallIntent } from './paywallIntent';
import { fetchPreviewRestaurants } from './previewSearch';

export type PaywallRestaurant = { id: string; name: string; photoUrl?: string };
export interface PaywallDiscovery { selected?: PaywallRestaurant; catalogFallback?: boolean; loading?: boolean }
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
      if (intent?.restaurantId && intent.restaurantName) {
        setValue({ selected: { id: intent.restaurantId, name: intent.restaurantName, photoUrl: intent.photoUrl } });
        return;
      }
      // The fallback is a real catalog result, queried for the launch city.
      // Never turn an illustrative stock photo into a claimed restaurant photo.
      const restaurants = await fetchPreviewRestaurants(LOS_ANGELES);
      if (live) setValue(restaurants[0]
        ? { selected: { id: restaurants[0].id, name: restaurants[0].name, photoUrl: restaurants[0].photoUrl }, catalogFallback: true }
        : EMPTY_DISCOVERY);
    }).catch(() => { if (live) setValue(EMPTY_DISCOVERY); });
    return () => { live = false; };
  }, [focused]);
  return focused ? value : EMPTY_DISCOVERY;
}
