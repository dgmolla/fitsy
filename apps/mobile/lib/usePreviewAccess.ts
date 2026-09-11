import { useEffect, useState } from 'react';
import { usePurchases } from './usePurchases';
import { canPreviewAfterDecline, paywallVariants, readPaywallDecline, subscribePaywallAccess } from './paywallAccess';

/** This bounds the product preview; the API still enforces data access. */
export function usePreviewAccess() {
  const { offering, isLapsed } = usePurchases();
  const [declined, setDeclined] = useState<boolean | null>(null);
  const variants = paywallVariants(offering?.metadata);
  useEffect(() => {
    let live = true;
    const read = () => { void readPaywallDecline().then(value => { if (live) setDeclined(value); }); };
    const unsubscribe = subscribePaywallAccess(read); read();
    return () => { live = false; unsubscribe(); };
  }, []);
  return { ...variants, ready: declined !== null, canPreview: declined !== null && canPreviewAfterDecline(declined || isLapsed, variants.access) };
}
