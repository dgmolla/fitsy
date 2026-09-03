import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { syncSubscriptionFromRevenueCat } from "@/lib/subscription";

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

interface RevenueCatEvent {
  type?: string;
  app_user_id?: string;
  /** Every app user id RevenueCat has merged into this customer. */
  aliases?: string[];
  product_id?: string;
  expiration_at_ms?: number | null;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  /** TRANSFER only: the customers the store subscription moved between. */
  transferred_from?: string[];
  transferred_to?: string[];
}

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
 * both sides are re-read from RevenueCat; if that isn't possible, the old
 * owners are at least marked expired so they can't keep an entitlement
 * RevenueCat has already revoked.
 */
async function handleTransfer(event: RevenueCatEvent): Promise<void> {
  const from = (event.transferred_from ?? []).filter((id) => !isAnonymous(id));
  const to = (event.transferred_to ?? []).filter((id) => !isAnonymous(id));
  for (const id of to) await syncSubscriptionFromRevenueCat(id);
  for (const id of from) {
    const synced = await syncSubscriptionFromRevenueCat(id);
    if (synced === null) {
      await prisma.subscription.updateMany({
        where: { userId: id },
        data: { status: "expired" },
      });
    }
  }
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = (body as { event?: RevenueCatEvent } | null)?.event;
  if (!event || typeof event.type !== "string") {
    return NextResponse.json({ error: "Missing event" }, { status: 400 });
  }

  if (event.type === "TRANSFER") {
    try {
      await handleTransfer(event);
      return NextResponse.json({ received: true }, { status: 200 });
    } catch {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // TEST events (dashboard) and any lifecycle type we don't model: acknowledge
  // without persisting, so an unrecognized event can't change entitlement state.
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const appUserId = resolveUserId(event);
  // Anonymous ids (pre-login, never merged) and missing ids can't map to a
  // User row. Ack so RevenueCat doesn't retry indefinitely; nothing to persist.
  if (!appUserId) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Only accept a sane positive epoch-ms; ignore 0/negative/garbage.
  const expiresAt =
    typeof event.expiration_at_ms === "number" && event.expiration_at_ms > 0
      ? new Date(event.expiration_at_ms)
      : null;
  const status = statusForEvent(event.type, expiresAt);
  const plan = event.product_id ?? "unknown";
  const appleTransactionId =
    event.original_transaction_id ?? event.transaction_id ?? null;

  // ─── Persist ─────────────────────────────────────────────────────────────────
  try {
    // The Subscription FK requires the User to exist. If it doesn't (deleted
    // account, or an event for a user we never provisioned), acknowledge and
    // move on instead of 500-ing into a RevenueCat retry loop.
    const user = await prisma.user.findUnique({
      where: { id: appUserId },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    await prisma.subscription.upsert({
      where: { userId: appUserId },
      create: {
        userId: appUserId,
        plan,
        status,
        expiresAt,
        appleTransactionId,
      },
      update: {
        plan,
        status,
        expiresAt,
        appleTransactionId,
      },
    });

    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    // Transient DB error — 500 so RevenueCat retries with backoff.
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
