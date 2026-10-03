import { unstable_cache } from "next/cache";
import { TRIAL_CATALOG_POLICY, trialCatalogMismatch } from "../../../packages/shared/src/contracts/trialPolicy";
import { reportServerError } from "./errorAlert";
import {
  ascAppId,
  ascGet,
  ascToken,
  isAscConfigured,
} from "@/services/ascService";

/**
 * Subscription prices for public display (landing page FAQ).
 *
 * Source of truth is App Store Connect: the subscription products the app
 * sells, priced in the USA territory, plus their introductory free trial.
 * The mobile paywall reads the same prices live through RevenueCat; this
 * loader keeps the website honest without a second hand-maintained copy.
 *
 * Only successful ASC reads are cached (24h). If ASC is not configured in
 * this environment (preview, dev) the fallback is used quietly; if ASC fails
 * in an environment where it is configured, the fallback is used and the
 * failure is reported through the normal server-error alert, and nothing is
 * cached so the next request retries.
 */

export interface DisplayPricing {
  /** e.g. "$7.99" */
  monthly: string;
  /** e.g. "$39.99" */
  annual: string;
  /** 0 when there is no free trial. */
  trialDays: number;
}

/** Fallback retail prices; an unavailable catalog cannot justify a trial claim. */
export const PRICING_FALLBACK: DisplayPricing = {
  monthly: "$7.99",
  annual: "$39.99",
  trialDays: 0,
};

/** ASC product identifiers (App Store Connect, Subscriptions). */
const KEY_BY_PRODUCT_ID: Record<string, "monthly" | "annual"> = {
  [TRIAL_CATALOG_POLICY.productIds[0]]: "monthly",
  [TRIAL_CATALOG_POLICY.productIds[1]]: "annual",
};

const TERRITORY = "USA";

/** ASC introductory-offer durations, in days. */
const DURATION_DAYS: Record<string, number> = {
  THREE_DAYS: 3,
  ONE_WEEK: 7,
  TWO_WEEKS: 14,
  ONE_MONTH: 30,
  TWO_MONTHS: 60,
  THREE_MONTHS: 90,
  SIX_MONTHS: 180,
  ONE_YEAR: 365,
};

type Group = { id: string };
type Subscription = { id: string; attributes?: { productId?: string } };
type PriceRow = {
  attributes?: { startDate?: string | null; preserved?: boolean };
  relationships?: { subscriptionPricePoint?: { data?: { id?: string } } };
};
type PricePoint = { id?: string; attributes?: { customerPrice?: string } };
type IntroOffer = {
  attributes?: {
    offerMode?: string;
    duration?: string;
    startDate?: string | null;
    endDate?: string | null;
  };
};

function formatUsd(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Unparseable price "${raw}"`);
  return `$${n.toFixed(2)}`;
}

/**
 * The price in effect today. ASC returns one row per schedule entry: the
 * current one (startDate null), scheduled increases (future startDate) and
 * preserved rows for grandfathered subscribers. Pick the non-preserved row
 * with the latest startDate that is not in the future.
 */
function currentPrice(
  rows: PriceRow[],
  points: PricePoint[],
  today: string,
): string {
  const effective = rows
    .filter((r) => !r.attributes?.preserved)
    .filter((r) => !r.attributes?.startDate || r.attributes.startDate <= today)
    .sort((a, b) =>
      (a.attributes?.startDate ?? "").localeCompare(
        b.attributes?.startDate ?? "",
      ),
    );
  const row = effective[effective.length - 1];
  const pointId = row?.relationships?.subscriptionPricePoint?.data?.id;
  const point = points.find((p) => p.id === pointId);
  if (!point?.attributes?.customerPrice)
    throw new Error("No current price row");
  return formatUsd(point.attributes.customerPrice);
}

/** Free-trial length in days from the offer in effect today, 0 if none. */
function currentTrialDays(offers: IntroOffer[], today: string): number {
  const live = offers.find((o) => {
    const a = o.attributes;
    if (a?.offerMode !== "FREE_TRIAL") return false;
    if (a.startDate && a.startDate > today) return false;
    if (a.endDate && a.endDate < today) return false;
    return true;
  });
  const days = live?.attributes?.duration
    ? DURATION_DAYS[live.attributes.duration]
    : undefined;
  if (live && days === undefined)
    throw new Error(`Unknown trial duration "${live.attributes?.duration}"`);
  return days ?? 0;
}

/** Uncached: walk app -> subscription groups -> subscriptions -> USA price + trial. Throws on any gap. */
export async function fetchPricingFromAsc(
  now: Date = new Date(),
): Promise<DisplayPricing> {
  const today = now.toISOString().slice(0, 10);
  const token = ascToken();
  const get = <T>(path: string) => ascGet<T>(path, { token });

  const groups = await get<{ data?: Group[] }>(
    `/apps/${ascAppId()}/subscriptionGroups`,
  );
  const subsPerGroup = await Promise.all(
    (groups.data ?? []).map((g) =>
      get<{ data?: Subscription[] }>(
        `/subscriptionGroups/${g.id}/subscriptions?fields[subscriptions]=productId`,
      ),
    ),
  );
  const wanted = subsPerGroup
    .flatMap((r) => r.data ?? [])
    .map((s) => ({
      id: s.id,
      key: KEY_BY_PRODUCT_ID[s.attributes?.productId ?? ""],
    }))
    .filter(
      (s): s is { id: string; key: "monthly" | "annual" } =>
        s.key !== undefined,
    );

  const resolved = await Promise.all(
    wanted.map(async ({ id, key }) => {
      const [prices, offers] = await Promise.all([
        get<{ data?: PriceRow[]; included?: PricePoint[] }>(
          `/subscriptions/${id}/prices?filter[territory]=${TERRITORY}&include=subscriptionPricePoint`,
        ),
        get<{ data?: IntroOffer[] }>(
          `/subscriptions/${id}/introductoryOffers?filter[territory]=${TERRITORY}`,
        ),
      ]);
      return {
        key,
        price: currentPrice(prices.data ?? [], prices.included ?? [], today),
        trialDays: currentTrialDays(offers.data ?? [], today),
      };
    }),
  );

  const monthly = resolved.find((r) => r.key === "monthly");
  const annual = resolved.find((r) => r.key === "annual");
  if (!monthly || !annual) {
    throw new Error(
      `ASC pricing incomplete: monthly=${monthly?.price ?? "?"} annual=${annual?.price ?? "?"}`,
    );
  }
  for (const plan of [monthly, annual]) {
    const mismatch = trialCatalogMismatch(plan.trialDays);
    if (mismatch) reportServerError(`ASC ${plan.key} trial catalog mismatch`, new Error(mismatch));
  }
  // A generic website claim is only true when both plans share the same offer.
  return {
    monthly: monthly.price,
    annual: annual.price,
    trialDays: monthly.trialDays === annual.trialDays ? monthly.trialDays : 0,
  };
}

/** Successful ASC reads only; a throw is not cached, so the next request retries. */
const getCachedAscPricing = unstable_cache(
  () => fetchPricingFromAsc(),
  ["asc-display-pricing"],
  {
    revalidate: 86400,
  },
);

/** Display pricing with fallback. Never throws. */
export async function getDisplayPricing(): Promise<DisplayPricing> {
  if (!isAscConfigured()) return PRICING_FALLBACK;
  try {
    return await getCachedAscPricing();
  } catch (err) {
    reportServerError("landing pricing (ASC)", err);
    return PRICING_FALLBACK;
  }
}

/** Describe the catalog offer without promising eligibility to every visitor. */
export function priceAnswer(p: DisplayPricing): string {
  const plans = `${p.monthly} a month or ${p.annual} a year`;
  if (p.trialDays > 0) {
    return `Eligible new subscribers may receive a ${p.trialDays}-day free trial, then ${plans}. If eligible, nothing is charged until the trial ends. The store confirms your offer before purchase. Cancel anytime.`;
  }
  return `${plans}. Cancel anytime.`;
}
