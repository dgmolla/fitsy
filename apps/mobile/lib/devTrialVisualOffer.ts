import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

/** Visual-only eligible offer on the real Test Store prices. Never purchase it. */
export function devTrialVisualOffer(offering: PurchasesOffering | null, requested: boolean, development = __DEV__, days: 7 | 14 = 7) {
  if (!development || !requested || !offering) return null;
  const preview = (pkg: PurchasesPackage | null): PurchasesPackage | null => pkg && pkg.product.priceString && pkg.product.subscriptionPeriod
    ? { ...pkg, product: { ...pkg.product, introPrice: {
      price: 0, priceString: 'Free', cycles: 1, period: days === 14 ? 'P2W' : 'P1W', periodUnit: 'WEEK', periodNumberOfUnits: days / 7,
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
