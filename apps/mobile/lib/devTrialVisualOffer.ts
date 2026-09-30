import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { TRIAL_CATALOG_POLICY } from '../../../packages/shared/src/contracts/trialPolicy';

/** Visual-only eligible offer on the real Test Store prices. Never purchase it. */
export function devTrialVisualOffer(offering: PurchasesOffering | null, requested: boolean, development = __DEV__) {
  if (!development || !requested || !offering) return null;
  const preview = (pkg: PurchasesPackage | null): PurchasesPackage | null => pkg && pkg.product.priceString && pkg.product.subscriptionPeriod
    ? { ...pkg, product: { ...pkg.product, introPrice: {
      price: 0, priceString: 'Free', cycles: 1, period: `P${TRIAL_CATALOG_POLICY.desiredDays}D`, periodUnit: 'DAY', periodNumberOfUnits: TRIAL_CATALOG_POLICY.desiredDays,
    } } }
    : null;
  const annual = preview(offering.annual);
  const monthly = preview(offering.monthly);
  if (!annual && !monthly) return null;
  const packages = new Map([annual, monthly].filter((pkg): pkg is PurchasesPackage => !!pkg).map(pkg => [pkg.identifier, pkg]));
  return {
    offering: { ...offering, annual, monthly, availablePackages: offering.availablePackages.map(pkg => packages.get(pkg.identifier) ?? pkg) },
    eligibility: Object.fromEntries([...packages.values()].map(pkg => [pkg.product.identifier, true])) as Record<string, boolean>,
  };
}
