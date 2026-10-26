import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { TRIAL_CATALOG_POLICY } from '../../../packages/shared/src/contracts/trialPolicy';

export type DevTrialVisualScenario = 7 | 14 | 'annual-short' | 'monthly-short';

/** Keep the same synthetic catalog through the entire onboarding journey. */
export function devTrialVisualScenario(value: string | undefined, development = __DEV__): DevTrialVisualScenario | null {
  if (!development) return null;
  if (value === '1' || value === '14') return 14;
  if (value === '7') return 7;
  return value === 'annual-short' || value === 'monthly-short' ? value : null;
}

/** Visual-only eligible offer on the real Test Store prices. Never purchase it. */
export function devTrialVisualOffer(offering: PurchasesOffering | null, requested: boolean, development = __DEV__, scenario: DevTrialVisualScenario = TRIAL_CATALOG_POLICY.desiredDays) {
  if (!development || !requested || !offering) return null;
  const preview = (pkg: PurchasesPackage | null, days: 2 | 7 | 14): PurchasesPackage | null => pkg && pkg.product.priceString && pkg.product.subscriptionPeriod
    ? { ...pkg, product: { ...pkg.product, introPrice: {
      price: 0, priceString: 'Free', cycles: 1, period: days === 2 ? 'P2D' : days === 14 ? 'P2W' : 'P1W',
      periodUnit: days === 2 ? 'DAY' : 'WEEK', periodNumberOfUnits: days === 2 ? 2 : days / 7,
    } } }
    : null;
  const annualDays = scenario === 'annual-short' ? 2 : scenario === 'monthly-short' ? 7 : scenario;
  const monthlyDays = scenario === 'monthly-short' ? 2 : scenario === 'annual-short' ? 7 : scenario;
  const annual = preview(offering.annual, annualDays);
  const monthly = preview(offering.monthly, monthlyDays);
  if (!annual && !monthly) return null;
  const packages = new Map([annual, monthly].filter((pkg): pkg is PurchasesPackage => !!pkg).map(pkg => [pkg.identifier, pkg]));
  return {
    label: typeof scenario === 'number' ? `${scenario}-day trial` : `${annualDays}-day annual and ${monthlyDays}-day monthly trials`,
    offering: { ...offering, annual, monthly, availablePackages: offering.availablePackages.map(pkg => packages.get(pkg.identifier) ?? pkg) },
    eligibility: Object.fromEntries([...packages.values()].map(pkg => [pkg.product.identifier, true])) as Record<string, boolean>,
  };
}
