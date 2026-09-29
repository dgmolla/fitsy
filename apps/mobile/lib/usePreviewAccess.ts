import { useEffect, useState } from 'react';
import { usePurchases } from './usePurchases';
import { canPreviewAfterDecline, paywallVariants, readPaywallDecline, subscribePaywallAccess } from './paywallAccess';
import { readOnboardingPreviewEntry } from './onboardingPreviewEntry';

/** This bounds the product preview; the API still enforces data access. */
export function usePreviewAccess() {
  const { offering, isLapsed } = usePurchases();
  const [declined, setDeclined] = useState<boolean | null>(null);
  const [onboardingEntry, setOnboardingEntry] = useState<boolean | null>(null);
  const variants = paywallVariants(offering?.metadata);
  useEffect(() => {
    let live = true;
    const read = () => { void Promise.all([readPaywallDecline(), readOnboardingPreviewEntry()])
      .then(([value, entry]) => { if (live) { setDeclined(value); setOnboardingEntry(entry); } }); };
    const unsubscribe = subscribePaywallAccess(read); read();
    return () => { live = false; unsubscribe(); };
  }, []);
  // A new onboarding pass may show the bounded restaurant preview after an
  // earlier paywall decline. Lapsed accounts still take the win-back route;
  // full menus and paid tabs keep their independent entitlement checks.
  const ready = declined !== null && onboardingEntry !== null;
  return { ...variants, ready, canPreview: ready &&
    (canPreviewAfterDecline(declined || isLapsed, variants.access) || (onboardingEntry && !isLapsed)) };
}
