import { useEffect, useMemo, useState } from 'react';
import type { CustomerInfo, PurchasesOffering } from 'react-native-purchases';
import { withinMs } from './async';
import { fetchIntroEligibility } from './purchases';

export const INTRO_ELIGIBILITY_CAP_MS = 5000;

export function usePurchaseIntroEligibility({ offering, customerInfo, customerInfoSettled, entitled }: {
  offering: PurchasesOffering | null;
  customerInfo: CustomerInfo | null;
  customerInfoSettled: boolean;
  entitled: boolean | null;
}) {
  const [introResult, setIntroResult] = useState<{
    info: CustomerInfo; offering: PurchasesOffering; values: Record<string, boolean>;
  } | null>(null);
  useEffect(() => {
    let current = true;
    if (offering && customerInfo) {
      void withinMs(fetchIntroEligibility(offering.availablePackages.map(pkg => pkg.product.identifier)), INTRO_ELIGIBILITY_CAP_MS).catch(() => null).then(values => {
        if (current) setIntroResult({ info: customerInfo, offering, values: values ?? {} });
      });
    }
    return () => { current = false; };
  }, [offering, customerInfo]);

  // Reject an earlier account/offering result during the render before effects run.
  const introEligibility = useMemo(() =>
    introResult?.info === customerInfo && introResult?.offering === offering ? introResult.values : {},
  [introResult, customerInfo, offering]);
  // CustomerInfo can fail independently of the offering. Unknown eligibility
  // must lead to plan review without presenting a trial or hanging this route.
  const introEligibilityReady = !!offering && (customerInfo
    ? introResult?.info === customerInfo && introResult?.offering === offering
    : customerInfoSettled && entitled !== null);

  return { introEligibility, introEligibilityReady };
}
