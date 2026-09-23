import { useEffect, useState } from 'react';
import { getPaywallIntent } from './paywallIntent';

export type PaywallRestaurant = { id: string; name: string; photoUrl?: string };
export interface PaywallDiscovery { selected?: PaywallRestaurant }
const EMPTY_DISCOVERY: PaywallDiscovery = {};

/** Paywall context comes from the user's selection, without issuing a search. */
export function usePaywallDiscovery(focused: boolean): PaywallDiscovery {
  const [value, setValue] = useState<PaywallDiscovery>(EMPTY_DISCOVERY);
  useEffect(() => {
    setValue(EMPTY_DISCOVERY);
    if (!focused) return;
    let live = true;
    void getPaywallIntent().then(intent => {
      if (!live) return;
      setValue(intent?.restaurantId && intent.restaurantName ? {
        selected: { id: intent.restaurantId, name: intent.restaurantName, photoUrl: intent.photoUrl },
      } : EMPTY_DISCOVERY);
    }).catch(() => { /* A failed read leaves no previous selection visible. */ });
    return () => { live = false; };
  }, [focused]);
  return focused ? value : EMPTY_DISCOVERY;
}
