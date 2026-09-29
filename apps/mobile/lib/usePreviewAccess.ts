import { useEffect, useState } from 'react';
import { usePurchases } from './usePurchases';
import { canPreviewAfterDecline, paywallVariants, readPaywallDecline, subscribePaywallAccess } from './paywallAccess';

/** This bounds the product preview; the API still enforces data access. */
export function usePreviewAccess(fromOnboarding = false) {
  const { offering, isLapsed } = usePurchases();
  const [declined, setDeclined] = useState<boolean | null>(null);
  const variants = paywallVariants(offering?.metadata);
  useEffect(() => {
    let live = true;
    const read = () => { void readPaywallDecline().then(value => { if (live) setDeclined(value); }); };
    const unsubscribe = subscribePaywallAccess(read); read();
    return () => { live = false; unsubscribe(); };
  }, []);
  // A new onboarding pass may show the bounded restaurant preview after an
  // earlier paywall decline. Lapsed accounts still take the win-back route;
  // full menus and paid tabs keep their independent entitlement checks.
  return { ...variants, ready: declined !== null, canPreview: declined !== null &&
    (canPreviewAfterDecline(declined || isLapsed, variants.access) || (fromOnboarding && !isLapsed)) };
}
