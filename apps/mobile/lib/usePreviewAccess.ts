import { useEffect, useState } from 'react';
import { usePurchases } from './usePurchases';
import { canPreviewAfterDecline, paywallVariants, readPaywallDecline, subscribePaywallAccess } from './paywallAccess';
import { readOnboardingPreviewEntry, subscribeOnboardingPreviewEntry } from './onboardingPreviewEntry';

/** This bounds the product preview; the API still enforces data access. */
export function usePreviewAccess(allowOnboardingEntry = false) {
  const { offering, isLapsed } = usePurchases();
  const [declined, setDeclined] = useState<boolean | null>(null);
  const [onboardingEntry, setOnboardingEntry] = useState<boolean | null>(null);
  const variants = paywallVariants(offering?.metadata);
  useEffect(() => {
    let live = true;
    let revision = 0;
    const read = () => {
      const current = ++revision;
      void Promise.all([readPaywallDecline(), readOnboardingPreviewEntry()])
        .then(([value, entry]) => { if (live && current === revision) { setDeclined(value); setOnboardingEntry(entry); } });
    };
    const unsubscribePaywall = subscribePaywallAccess(read);
    const unsubscribeEntry = subscribeOnboardingPreviewEntry(read);
    read();
    return () => { live = false; unsubscribePaywall(); unsubscribeEntry(); };
  }, []);
  // A new onboarding pass may show the bounded restaurant preview after an
  // earlier paywall decline. Lapsed accounts still take the win-back route;
  // full menus and paid tabs keep their independent entitlement checks.
  const ready = declined !== null && onboardingEntry !== null;
  return { ...variants, ready, canPreview: ready &&
    (canPreviewAfterDecline(declined || isLapsed, variants.access) || (allowOnboardingEntry && onboardingEntry && !isLapsed)) };
}
