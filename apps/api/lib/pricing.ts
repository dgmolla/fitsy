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
 * ASC reads and unavailable results are cached for six hours across serverless
 * instances, limiting retries and alerts while the dependency is down.
 * No unverified offer is displayed.
 */

export interface DisplayPricing {
  /** e.g. "$7.99" */
  monthly: string;
  /** e.g. "$39.99" */
  annual: string;
  /** 0 when there is no free trial. */
  trialDays: number;
  /** Calendar offers retain their store unit instead of claiming fixed days. */
  trialLabel?: string;
}

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
};
const CALENDAR_DURATION_LABELS: Record<string, string> = {
  ONE_MONTH: "1 month",
  TWO_MONTHS: "2 months",
  THREE_MONTHS: "3 months",
  SIX_MONTHS: "6 months",
  ONE_YEAR: "1 year",
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

/** Preserve calendar units from the offer in effect today. */
function currentTrial(offers: IntroOffer[], today: string): { days: number; label?: string } {
  const live = offers.find((o) => {
    const a = o.attributes;
    if (a?.offerMode !== "FREE_TRIAL") return false;
    if (a.startDate && a.startDate > today) return false;
    if (a.endDate && a.endDate < today) return false;
    return true;
  });
  const duration = live?.attributes?.duration;
  const days = duration ? DURATION_DAYS[duration] : undefined;
  const label = duration ? CALENDAR_DURATION_LABELS[duration] : undefined;
  if (live && days === undefined && label === undefined)
    throw new Error(`Unknown trial duration "${live.attributes?.duration}"`);
  return { days: days ?? 0, ...(label ? { label } : {}) };
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
        trial: currentTrial(offers.data ?? [], today),
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
    const mismatch = trialCatalogMismatch(plan.trial.label ?? plan.trial.days);
    if (mismatch) reportServerError(`ASC ${plan.key} trial catalog mismatch`, new Error(mismatch));
  }
  // A generic website claim is only true when both plans share the same offer.
  return {
    monthly: monthly.price,
    annual: annual.price,
    trialDays: monthly.trial.days === annual.trial.days && monthly.trial.label === annual.trial.label ? monthly.trial.days : 0,
    ...(monthly.trial.label && monthly.trial.label === annual.trial.label ? { trialLabel: monthly.trial.label } : {}),
  };
}

/** One shared cache covers success and unavailable results for the same lifetime. */
const getCachedDisplayPricing = unstable_cache(
  async (): Promise<DisplayPricing | null> => {
    try {
      return await fetchPricingFromAsc();
    } catch (err) {
      reportServerError("landing pricing (ASC)", err);
      return null;
    }
  },
  ["asc-display-pricing-availability-v2"],
  { revalidate: 6 * 60 * 60 },
);

/** Display verified terms, or indicate that live terms are unavailable. */
export async function getDisplayPricing(): Promise<DisplayPricing | null> {
  if (!isAscConfigured()) return null;
  return getCachedDisplayPricing();
}

/** Describe verified catalog terms without promising eligibility. */
export function priceAnswer(p: DisplayPricing | null): string {
  if (!p) return "See current subscription prices and any available introductory offer in the app before you subscribe.";
  const plans = `${p.monthly} a month or ${p.annual} a year`;
  const trial = p.trialLabel ?? (p.trialDays > 0 ? `${p.trialDays}-day` : null);
  if (trial) {
    return `${plans}. A ${trial} free trial may be available if you are eligible. Check the app's purchase screen for your offer and first charge before you subscribe. Cancel anytime.`;
  }
  return `${plans}. Cancel anytime.`;
}
