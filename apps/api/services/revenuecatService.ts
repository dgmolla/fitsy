/**
 * RevenueCat REST (v1) subscriber lookup.
 *
 * The webhook (`app/api/revenuecat/webhook`) is the push path for entitlement
 * state; this is the pull path. It exists because the webhook alone can't be
 * the only source of truth:
 *   - TRANSFER events (same Apple ID, new Fitsy account) don't carry the
 *     product/expiry the new owner needs, so we have to ask RevenueCat;
 *   - the first search right after a purchase can race the webhook delivery;
 *   - a missed/failed delivery would otherwise lock a paying user out until
 *     the next renewal event.
 *
 * Authenticates with the app's PUBLIC SDK key - RevenueCat's v1 subscriber GET
 * is readable with it (it's what the mobile SDK itself uses), so no secret is
 * needed server-side. Reads for an unknown id create an empty customer, which
 * the SDK would do on `logIn` anyway.
 *
 * Docs: https://www.revenuecat.com/reference/subscribers
 */

const REVENUECAT_API = "https://api.revenuecat.com/v1";
const REVENUECAT_TIMEOUT_MS = 8_000;

/** The single entitlement the app gates on (RevenueCat dashboard id). */
export const PRO_ENTITLEMENT_ID = "pro";

export interface RevenueCatEntitlementState {
  /** Entitlement present and not past its expiry. */
  active: boolean;
  /** Store product identifier backing the entitlement, when present. */
  plan: string | null;
  /** `null` for lifetime / non-expiring grants. */
  expiresAt: Date | null;
  /** Store transaction id for the backing subscription, when RevenueCat exposes it. */
  transactionId: string | null;
  /**
   * The store reported a failed renewal charge and the subscription is in
   * its grace period. RevenueCat keeps the entitlement active meanwhile, so
   * `active` stays true; this just lets the DB keep the same
   * `billing_issue` status the webhook writes.
   */
  billingIssue: boolean;
}

interface SubscriberResponse {
  subscriber?: {
    entitlements?: Record<
      string,
      { expires_date?: string | null; product_identifier?: string | null }
    >;
    subscriptions?: Record<
      string,
      {
        store_transaction_id?: string | null;
        original_transaction_id?: string | null;
        billing_issues_detected_at?: string | null;
      }
    >;
  };
}

export function isRevenueCatConfigured(): boolean {
  return Boolean(process.env["REVENUECAT_PUBLIC_API_KEY"]);
}

/**
 * Current `pro` entitlement state for an app user id (= Supabase auth UUID).
 *
 * Returns `null` when the answer is unknown - not configured, network
 * failure, non-2xx, malformed body - so callers can tell "RevenueCat says no
 * entitlement" (a real `{ active: false }`) apart from "couldn't ask", and
 * never downgrade a subscription on the latter.
 */
export async function fetchProEntitlement(
  appUserId: string,
): Promise<RevenueCatEntitlementState | null> {
  const key = process.env["REVENUECAT_PUBLIC_API_KEY"];
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REVENUECAT_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${REVENUECAT_API}/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: { authorization: `Bearer ${key}`, "x-platform": "ios" },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      console.warn(`[revenuecat] subscriber lookup failed: ${res.status}`);
      return null;
    }
    const body = (await res.json()) as SubscriberResponse;
    const subscriber = body.subscriber;
    if (!subscriber || typeof subscriber !== "object") return null;

    const ent = subscriber.entitlements?.[PRO_ENTITLEMENT_ID];
    if (!ent) {
      return { active: false, plan: null, expiresAt: null, transactionId: null, billingIssue: false };
    }

    const expiresAt = ent.expires_date ? new Date(ent.expires_date) : null;
    const validExpiry = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null;
    const plan = ent.product_identifier ?? null;
    const sub = plan ? subscriber.subscriptions?.[plan] : undefined;
    return {
      active: validExpiry ? validExpiry.getTime() > Date.now() : true,
      plan,
      expiresAt: validExpiry,
      transactionId: sub?.original_transaction_id ?? sub?.store_transaction_id ?? null,
      billingIssue: Boolean(sub?.billing_issues_detected_at),
    };
  } catch (err) {
    console.warn("[revenuecat] subscriber lookup error", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
