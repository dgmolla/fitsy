import { unstable_cache } from "next/cache";
import { ascAppId, ascConfigured, ascGet } from "./asc";

/**
 * Subscription prices for public display (landing page FAQ).
 *
 * Source of truth is App Store Connect: the subscription products the app
 * sells, priced in the USA territory. The mobile paywall reads the same
 * prices live through RevenueCat; this loader keeps the website honest
 * without a second hand-maintained copy.
 *
 * Cached for a day. Any failure (no ASC credentials in this environment,
 * network, shape change) falls back to the values in the Pricing Decision
 * Record (docs/product/business-model.md) so the page never breaks.
 */

export interface DisplayPricing {
  /** e.g. "$7.99" */
  monthly: string;
  /** e.g. "$39.99" */
  annual: string;
  trialDays: number;
  /** Where the numbers came from, for logging and tests. */
  source: "app-store-connect" | "fallback";
}

/** Mirrors docs/product/business-model.md → Pricing Decision Record. */
export const PRICING_FALLBACK: DisplayPricing = {
  monthly: "$7.99",
  annual: "$39.99",
  trialDays: 3,
  source: "fallback",
};

/** ASC product identifiers (App Store Connect → Subscriptions). */
export const PRODUCT_IDS = {
  monthly: "com.fitsy.mobile.monthly",
  annual: "com.fitsy.mobile.yearly",
} as const;

const TERRITORY = "USA";

type Group = { id: string };
type Subscription = { id: string; attributes?: { productId?: string } };
type PricePoint = {
  type?: string;
  attributes?: { customerPrice?: string };
};

function formatUsd(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Unparseable price "${raw}"`);
  return `$${n.toFixed(2)}`;
}

/** Uncached: walk app → subscription group → subscriptions → USA price point. */
export async function fetchPricingFromAsc(): Promise<DisplayPricing> {
  const groups = await ascGet<{ data?: Group[] }>(
    `/apps/${ascAppId()}/subscriptionGroups`,
  );
  const wanted = new Set<string>(Object.values(PRODUCT_IDS));
  const found: Partial<Record<keyof typeof PRODUCT_IDS, string>> = {};

  for (const group of groups.data ?? []) {
    const subs = await ascGet<{ data?: Subscription[] }>(
      `/subscriptionGroups/${group.id}/subscriptions?fields[subscriptions]=productId`,
    );
    for (const sub of subs.data ?? []) {
      const productId = sub.attributes?.productId;
      if (!productId || !wanted.has(productId)) continue;
      const prices = await ascGet<{ included?: PricePoint[] }>(
        `/subscriptions/${sub.id}/prices?filter[territory]=${TERRITORY}&include=subscriptionPricePoint&limit=5`,
      );
      const point = (prices.included ?? []).find(
        (p) =>
          p.type === "subscriptionPricePoints" && p.attributes?.customerPrice,
      );
      if (!point?.attributes?.customerPrice) continue;
      const key = (
        Object.keys(PRODUCT_IDS) as Array<keyof typeof PRODUCT_IDS>
      ).find((k) => PRODUCT_IDS[k] === productId);
      if (key) found[key] = formatUsd(point.attributes.customerPrice);
    }
  }

  if (!found.monthly || !found.annual) {
    throw new Error(
      `ASC pricing incomplete: monthly=${found.monthly ?? "?"} annual=${found.annual ?? "?"}`,
    );
  }
  return {
    monthly: found.monthly,
    annual: found.annual,
    trialDays: PRICING_FALLBACK.trialDays,
    source: "app-store-connect",
  };
}

/** Resolve display pricing with fallback; never throws. */
export async function resolveDisplayPricing(): Promise<DisplayPricing> {
  if (!ascConfigured()) return PRICING_FALLBACK;
  try {
    return await fetchPricingFromAsc();
  } catch (err) {
    console.warn("[pricing] falling back to decision-record prices:", err);
    return PRICING_FALLBACK;
  }
}

/** Cached for 24h; the landing page calls this. */
export const getDisplayPricing = unstable_cache(
  resolveDisplayPricing,
  ["asc-display-pricing"],
  {
    revalidate: 86400,
  },
);
