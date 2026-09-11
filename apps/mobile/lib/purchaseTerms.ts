import type { PurchasesStoreProduct } from 'react-native-purchases';

type ProductTerms = Pick<PurchasesStoreProduct, 'priceString' | 'subscriptionPeriod' | 'introPrice'>;
type ComparableProduct = Pick<PurchasesStoreProduct, 'price' | 'currencyCode' | 'subscriptionPeriod'>;

/** Store periods are ISO 8601; a week is expressed in days for trial copy. */
export function periodLabel(period: string | null, cycles = 1, trial = false): string | null {
  const match = /^P([1-9]\d*)([DWMY])$/.exec(period ?? '');
  if (!match || !Number.isSafeInteger(cycles) || cycles < 1) return null;
  let count = Number(match[1]) * cycles;
  let unit = ({ D: 'day', W: 'week', M: 'month', Y: 'year' } as const)[match[2] as 'D' | 'W' | 'M' | 'Y'];
  if (trial && unit === 'week') { count *= 7; unit = 'day'; }
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** Missing or unknown eligibility must never promise a free trial. */
export function purchaseTerms(product: ProductTerms | null | undefined, eligible?: boolean) {
  const period = periodLabel(product?.subscriptionPeriod ?? null);
  if (!product?.priceString || !period) return null;
  const price = product.priceString;
  const recurring = `${price} every ${period}`;
  const intro = eligible ? product.introPrice : null;
  const introductoryDuration = intro ? periodLabel(intro.period, intro.cycles, true) : null;
  const trial = intro?.price === 0 ? introductoryDuration : null;
  const introPeriod = intro ? periodLabel(intro.period) : null;
  let charge = `${price} charged when you confirm your purchase.`;
  if (eligible === undefined && product.introPrice) {
    charge = `The store will confirm any eligible introductory offer and the first charge before purchase.`;
  }
  if (trial) charge = `${trial} free, then ${recurring}. No charge until the trial ends.`;
  else if (intro && introductoryDuration && introPeriod && intro.price > 0) {
    charge = `${intro.priceString} every ${introPeriod} for ${introductoryDuration}, then ${recurring}.`;
  }
  return {
    price, period, recurring, trial,
    disclosure: `${charge} Renews automatically at ${recurring} unless canceled at least 24 hours before renewal. Manage or cancel in your device's subscription settings.`,
  };
}

/** Compare only like-for-like store products; never invent a discount. */
export function savingPercent(regular: ComparableProduct | null | undefined, discounted: ComparableProduct | null | undefined): number | null {
  if (!regular || !discounted || !regular.subscriptionPeriod ||
    regular.subscriptionPeriod !== discounted.subscriptionPeriod || regular.currencyCode !== discounted.currencyCode ||
    !Number.isFinite(regular.price) || !Number.isFinite(discounted.price) || regular.price <= 0 || discounted.price < 0 || discounted.price >= regular.price) return null;
  return Math.round((1 - discounted.price / regular.price) * 100);
}
