import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import {
  readUserAndRow,
  syncSubscriptionFromRevenueCat,
  type SubscriptionRow,
} from "@/lib/subscription";
import { persistEvent } from "./persistEvent";
import { isDevelopmentEnvironment } from "@/services/runtimeEnvironment";
import { PRO_ENTITLEMENT_ID } from "@/services/revenuecatService";
import { parseRequestInput } from '@/lib/requestInput';
import { lifecycleEventSchema, transferEventSchema, webhookEnvelopeSchema, WEBHOOK_BODY_MAX_BYTES, type RevenueCatEvent } from './input';

function activePeriodRecorded(row: SubscriptionRow, expiresAt: Date | null): boolean {
  return row?.status === "active" &&
    (!expiresAt || (row.expiresAt != null && row.expiresAt.getTime() >= expiresAt.getTime()));
}

/** Constant-time compare for the webhook auth header (avoids timing leaks). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * RevenueCat webhook — server-side source of truth for subscription state.
 *
 * RevenueCat POSTs a lifecycle event here on purchase / renewal / cancellation
 * / expiration / billing issue. We sync the event into the `Subscription` table
 * so the backend can make server-trusted entitlement checks without trusting
 * the client. This REPLACES the (stubbed) Apple-receipt validation in
 * `/api/subscriptions/verify` — clients no longer send receipts; RevenueCat
 * validates and notifies us.
 *
 * `app_user_id` equals the Supabase auth UUID (= `User.id` = `Subscription.userId`)
 * because the mobile client calls `Purchases.logIn(session.user.id)`.
 *
 * Security: RevenueCat sends the Authorization header value configured in the
 * dashboard (Integrations → Webhooks). We require `REVENUECAT_WEBHOOK_AUTH` to
 * be set and to match exactly, else the endpoint is closed.
 *
 * Idempotency: RevenueCat retries on non-2xx and does not guarantee ordering,
 * and `syncSubscriptionFromRevenueCat` (REST pull) can land between two
 * deliveries. Each row remembers the time of the newest event applied to it
 * (`lastEventAt`); a lifecycle event older than that is acked without
 * writing, so an out-of-order delivery can never regress a subscription to an
 * older state. Equal timestamps apply (a duplicate re-applies the same
 * payload harmlessly). If a stale event disagrees with the stored status,
 * RevenueCat's current REST state is re-read as the tiebreaker rather than
 * trusting either side.
 *
 * Docs: https://www.revenuecat.com/docs/integrations/webhooks
 */

// Event types that mean the entitlement is (or remains) granted. CANCELLATION
// is intentionally treated as still-active: the user keeps access until the
// period ends; EXPIRATION is the event that actually revokes it.
const ACTIVE_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
  "CANCELLATION",
]);

// Every lifecycle type we model. Unknown types are acknowledged but NOT
// persisted, so a future RevenueCat event we don't recognize can never
// accidentally flip a subscription to "active".
const HANDLED_EVENT_TYPES = new Set([
  ...ACTIVE_EVENT_TYPES,
  "EXPIRATION",
  "BILLING_ISSUE",
]);

const ANONYMOUS_PREFIX = "$RCAnonymousID:";

function isAnonymous(id: string): boolean {
  return id.startsWith(ANONYMOUS_PREFIX);
}

/**
 * The Supabase user id an event belongs to. RevenueCat reports the id the
 * purchase was made under; if that was an anonymous pre-login id, the
 * logged-in id it was later merged with is in `aliases`.
 */
function resolveUserId(event: RevenueCatEvent): string | null {
  const primary = event.app_user_id;
  if (primary && !isAnonymous(primary)) return primary;
  return event.aliases?.find((a) => !isAnonymous(a)) ?? null;
}

/**
 * TRANSFER: the same store subscription (same Apple ID) now belongs to a
 * different Fitsy account - a reinstall with a new sign-in, or Restore
 * Purchases on a second account. The event carries no product/expiry, so
 * both sides are re-read from RevenueCat.
 *
 * Returns false when a NEW owner couldn't be synced (RevenueCat unreachable
 * or not configured): the caller must 500 so RevenueCat retries, because
 * acking would leave nobody entitled - the old owners are still expired
 * below, which is what RevenueCat has already decided and is idempotent.
 */
async function handleTransfer(event: RevenueCatEvent): Promise<boolean> {
  const from = (event.transferred_from ?? []).filter((id) => !isAnonymous(id));
  const to = (event.transferred_to ?? []).filter((id) => !isAnonymous(id));
  const [toResults, fromResults] = await Promise.all([
    Promise.all(to.map((id) => syncSubscriptionFromRevenueCat(id))),
    Promise.all(from.map((id) => syncSubscriptionFromRevenueCat(id))),
  ]);
  // Stamped "now" so a delayed pre-transfer RENEWAL for the old account is
  // dropped as stale instead of reviving an entitlement that moved away.
  const expiredAt = new Date();
  await Promise.all(
    from
      .filter((_, i) => fromResults[i] === null)
      .map((id) =>
        prisma.subscription.updateMany({
          where: { userId: id },
          data: { status: "expired", lastEventAt: expiredAt },
        }),
      ),
  );
  return toResults.every((r) => r !== null);
}

// Precondition: `type` is in HANDLED_EVENT_TYPES (callers ack unknown types).
function statusForEvent(type: string, expiresAt: Date | null): string {
  if (type === "EXPIRATION") return "expired";
  if (type === "BILLING_ISSUE") return "billing_issue";
  // Active event, but if RevenueCat says active while the period already lapsed,
  // reflect that rather than reporting a stale "active".
  if (expiresAt && expiresAt.getTime() < Date.now()) return "expired";
  return "active";
}

/** Equal instants, with null only equal to null. */
function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

// TRANSFER fans out to RevenueCat (8s timeout each, in parallel) plus DB
// writes - give it headroom over Vercel's 10s default.
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ─── Auth ──────────────────────────────────────────────────────────────────
  const expected = process.env["REVENUECAT_WEBHOOK_AUTH"];
  if (!expected) {
    // Misconfigured: refuse rather than run an open webhook.
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── Parse ─────────────────────────────────────────────────────────────────
  const body = await parseRequestInput(request, webhookEnvelopeSchema, WEBHOOK_BODY_MAX_BYTES, 'Invalid webhook payload');
  if (body instanceof NextResponse) return body;
  // Unknown events are intentionally opaque, including future identity fields.
  if (body.event.type !== 'TRANSFER' && !HANDLED_EVENT_TYPES.has(body.event.type)) {
    return NextResponse.json({ received: true });
  }
  const parsed = (body.event.type === 'TRANSFER' ? transferEventSchema : lifecycleEventSchema).safeParse(body.event);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
  const event = parsed.data;

  // A genuine sandbox purchase must never grant production access. TRANSFER
  // has no entitlement list, may omit environment, and is resolved by the
  // equally scoped REST read rather than granting access from its payload.
  if (!isDevelopmentEnvironment()) {
    if (event.environment === "SANDBOX") return NextResponse.json({ received: true });
    if (event.environment !== "PRODUCTION" &&
      !(event.type === "TRANSFER" && event.environment === undefined)) {
      return NextResponse.json({ error: "Missing purchase environment" }, { status: 400 });
    }
  }
  if (HANDLED_EVENT_TYPES.has(event.type)) {
    if (!event.entitlement_ids?.includes(PRO_ENTITLEMENT_ID)) return NextResponse.json({ received: true });
  }

  if (event.type === "TRANSFER") {
    try {
      if (!(await handleTransfer(event))) {
        return NextResponse.json(
          { error: "RevenueCat lookup unavailable" },
          { status: 500 },
        );
      }
      return NextResponse.json({ received: true }, { status: 200 });
    } catch {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  const appUserId = resolveUserId(event);
  // Anonymous ids (pre-login, never merged) and missing ids can't map to a
  // User row. Ack so RevenueCat doesn't retry indefinitely; nothing to persist.
  if (!appUserId) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const expiresAt = event.expiration_at_ms == null ? null : new Date(event.expiration_at_ms);
  const status = statusForEvent(event.type, expiresAt);
  const activePeriodEvent = status === "active" &&
    ["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED"].includes(event.type);
  const plan = event.product_id ?? "unknown";
  const appleTransactionId =
    event.original_transaction_id ?? event.transaction_id ?? null;
  // An event with an omitted/null timestamp is treated as "now" rather than dropped:
  // losing a real lifecycle event is worse than applying it out of order.
  const eventAt = event.event_timestamp_ms == null ? new Date() : new Date(event.event_timestamp_ms);

  // ─── Persist ─────────────────────────────────────────────────────────────────
  try {
    // The Subscription FK requires the User to exist. If it doesn't (deleted
    // account, or an event for a user we never provisioned), acknowledge and
    // move on instead of 500-ing into a RevenueCat retry loop.
    const { userExists, row: existing } = await readUserAndRow(appUserId);
    if (!userExists) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Stale delivery: the row already reflects something newer (a later
    // event, or a REST sync). Never apply it, but if it disagrees with what
    // is stored - status OR expiry, since a RENEWAL keeps "active" and only
    // moves expiresAt - our ordering assumption may be wrong (clock skew, a
    // sync that raced a renewal), so let RevenueCat's current truth settle
    // it. If that truth can't be read, 500 so RevenueCat retries (as
    // handleTransfer does): acking would leave a possibly-wrong row in place
    // with nothing left to correct it. A stale event that agrees with the
    // row is simply acked.
    if (existing?.lastEventAt && existing.lastEventAt.getTime() > eventAt.getTime()) {
      if (existing.status !== status || !sameInstant(existing.expiresAt, expiresAt)) {
        console.warn('[subscription] stale_event_conflict');
        const reconciled = await syncSubscriptionFromRevenueCat(appUserId);
        const pendingPeriod = activePeriodEvent && !activePeriodRecorded((await readUserAndRow(appUserId)).row, expiresAt);
        if (reconciled === null || pendingPeriod) {
          console.warn(reconciled === null ? '[subscription] tiebreak_unavailable' : '[subscription] purchase_reconciliation_pending');
          return NextResponse.json({ error: "RevenueCat lookup unresolved" }, { status: 500 });
        }
      }
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const applied = await persistEvent({ userId: appUserId, existing, plan, status, expiresAt, appleTransactionId, eventAt });
    if (!applied && activePeriodEvent) {
      const latest = (await readUserAndRow(appUserId)).row;
      if (!activePeriodRecorded(latest, expiresAt)) {
        await syncSubscriptionFromRevenueCat(appUserId);
        if (!activePeriodRecorded((await readUserAndRow(appUserId)).row, expiresAt)) {
          return NextResponse.json({ error: "RevenueCat purchase reconciliation pending" }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    // Transient DB error — 500 so RevenueCat retries with backoff.
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
