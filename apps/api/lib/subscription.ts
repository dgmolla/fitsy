import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";
import type { JwtPayload } from "@/services/authService";
import { fetchProEntitlement } from "@/services/revenuecatService";

/**
 * Server-trusted subscription gate.
 *
 * Entitlement state is synced into the `Subscription` table by the RevenueCat
 * webhook (`apps/api/app/api/revenuecat/webhook`) and, on demand, by
 * `syncSubscriptionFromRevenueCat` (pull from RevenueCat's REST API - covers
 * transfers, webhook races and missed deliveries). This is the single source
 * of truth for entitlement: the mobile client's on-device RevenueCat `isPro`
 * is only a hint that triggers a sync, and the app gates on the verdict it
 * reads back from this server (GET /api/subscriptions/status), so the paywall
 * can't be bypassed by calling the API directly or by a stale device cache.
 *
 * Bypass (no active subscription required) for:
 *   - `ALLOW_STUB_SUBSCRIPTIONS=true`  → local dev / staging convenience.
 *   - `DEMO_REVIEW_EMAILS=a@x,b@y`     → App Store reviewer / demo accounts.
 */

/** Parsed comma-separated allowlist of emails that bypass the gate. */
function demoEmails(): Set<string> {
  return new Set(
    (process.env["DEMO_REVIEW_EMAILS"] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True when this email/env should skip the subscription requirement. */
export function subscriptionBypass(email: string): boolean {
  if (process.env["ALLOW_STUB_SUBSCRIPTIONS"] === "true") return true;
  return demoEmails().has(email.toLowerCase());
}

/**
 * Statuses that grant access while `expiresAt` is still in the future.
 * `billing_issue` is included on purpose: the store failed to charge a
 * renewal and the subscription is in its grace period, during which Apple
 * (and RevenueCat's entitlement) keep the user subscribed - locking them out
 * early would punish a card hiccup. The period's own expiry still applies.
 */
const ENTITLED_STATUSES = new Set(["active", "billing_issue"]);

export type SubscriptionRow = {
  status: string;
  expiresAt: Date | null;
  lastEventAt: Date | null;
} | null;

/** The fields every entitlement read or write needs; null when the user never subscribed. */
function readRow(userId: string): Promise<SubscriptionRow> {
  return prisma.subscription.findUnique({
    where: { userId },
    select: { status: true, expiresAt: true, lastEventAt: true },
  });
}

/**
 * What both write paths (webhook and REST sync) need before touching the
 * row: whether the User still exists (the Subscription FK needs it, and a
 * deleted account must be acked, not 500-ed) and the current row, if any.
 */
export async function readUserAndRow(
  userId: string,
): Promise<{ userExists: boolean; row: SubscriptionRow }> {
  const [user, row] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    readRow(userId),
  ]);
  return { userExists: user !== null, row };
}

/** The row grants access iff its status is entitled and it hasn't lapsed. */
function rowEntitled(sub: SubscriptionRow): boolean {
  if (!sub || !ENTITLED_STATUSES.has(sub.status)) return false;
  if (sub.expiresAt && sub.expiresAt.getTime() < Date.now()) return false;
  return true;
}

/**
 * Authoritative entitlement check. Active iff the synced row says `active`
 * (or `billing_issue`, see above) and it hasn't lapsed. Bypassed accounts
 * are always entitled.
 */
export async function isEntitled(userId: string, email: string): Promise<boolean> {
  if (subscriptionBypass(email)) return true;
  return rowEntitled(await readRow(userId));
}

export interface EntitlementStatus {
  /** Same verdict as `isEntitled` (bypass included). */
  active: boolean;
  /** Stored row status, or null when the user has never subscribed. */
  status: string | null;
  expiresAt: Date | null;
}

/**
 * `isEntitled` plus the raw row, in one read, for the status endpoint. The
 * row is reported even for bypassed accounts so support can see what the
 * store actually thinks; `active` alone is what the client gates on.
 */
export async function getEntitlementStatus(
  userId: string,
  email: string,
): Promise<EntitlementStatus> {
  const sub = await readRow(userId);
  return {
    active: subscriptionBypass(email) || rowEntitled(sub),
    status: sub?.status ?? null,
    expiresAt: sub?.expiresAt ?? null,
  };
}

export interface OptionalSubscriptionResult {
  payload: JwtPayload | null;
  entitled: boolean;
}

/**
 * Authenticate and check entitlement without ever rejecting the request: an
 * unauthenticated or unentitled caller gets `entitled: false` instead of a
 * 401/402, so the route can degrade to a locked/truncated response (the
 * onboarding teaser and the lapsed-subscriber browse-then-paywall flow)
 * rather than blocking access outright. Callers MUST check `entitled` before
 * returning any data gated behind the subscription.
 */
export async function optionalSubscription(
  request: NextRequest,
): Promise<OptionalSubscriptionResult> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return { payload: null, entitled: false };
  const entitled = await isEntitled(auth.sub, auth.email);
  return { payload: auth, entitled };
}

export interface SyncOptions {
  /**
   * Never persist a downgrade. Right after a purchase or restore RevenueCat's
   * REST view can lag StoreKit by a few seconds; writing `expired` then would
   * poison the row and bounce a paying user on their next launch. The read is
   * retried a few times and, if still inactive, nothing is written.
   */
  neverDowngrade?: boolean;
}

/**
 * Wall-clock budget for purchase/restore re-reads, measured from the first
 * read. Worst case (budget + one delay + one 8 s RevenueCat timeout) stays
 * well inside the route's 30 s maxDuration. It can exceed the client's 4 s
 * post-purchase cap on a cold start; that is fine because the client only
 * stops waiting - the request keeps running and the late write still lands.
 */
const DOWNGRADE_RETRY_BUDGET_MS = 6_000;
const DOWNGRADE_RETRY_DELAY_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Pull the user's current `pro` state from RevenueCat and write it to the
 * `Subscription` row, so the next `isEntitled` read reflects reality without
 * waiting for (or depending on) a webhook delivery.
 *
 * Returns the resulting entitlement, or `null` when nothing was written:
 * RevenueCat couldn't be consulted (not configured / unreachable), or
 * `neverDowngrade` blocked an inactive result. Either way a transient
 * condition can never downgrade a paying user.
 *
 * A user RevenueCat has never seen subscribe gets no row (nothing to record);
 * an existing row is updated to whatever RevenueCat says, including
 * `expired` when the entitlement moved to another account (TRANSFER).
 */
export async function syncSubscriptionFromRevenueCat(
  userId: string,
  { neverDowngrade = false }: SyncOptions = {},
): Promise<boolean | null> {
  // Fallback stamp when RevenueCat doesn't date its response: captured
  // BEFORE the call so the row never claims knowledge of events that
  // happened during the read (see `lastEventAt` below).
  const readStartedAt = new Date();
  let state = await fetchProEntitlement(userId);
  if (!state) return null;

  if (neverDowngrade) {
    let reads = 1;
    while (!state.active && Date.now() - readStartedAt.getTime() < DOWNGRADE_RETRY_BUDGET_MS) {
      await sleep(DOWNGRADE_RETRY_DELAY_MS);
      const again = await fetchProEntitlement(userId);
      reads++;
      if (!again) break;
      state = again;
    }
    if (!state.active) {
      const elapsed = Date.now() - readStartedAt.getTime();
      console.warn(
        `[subscription] ${userId} RevenueCat still inactive after ${reads} reads over ${elapsed} ms; ` +
          "not persisting a downgrade on a purchase/restore sync",
      );
      return null;
    }
  }

  const { userExists, row: existing } = await readUserAndRow(userId);
  // No User row = nothing the FK will let us attach to (deleted account, or
  // an id we never provisioned). Report what RevenueCat says, persist nothing.
  if (!userExists) return state.active;
  if (!state.active && !existing) return false;

  // Same status vocabulary as the webhook (`statusForEvent`), so the two
  // write paths never disagree on what a row means.
  const status = !state.active ? "expired" : state.billingIssue ? "billing_issue" : "active";
  // The row's lastEventAt orders this read against webhook events, whose
  // event_timestamp_ms is on RevenueCat's clock, so stamp RevenueCat's own
  // response time: a RENEWAL emitted after it is applied even if Vercel's
  // clock runs ahead, and one emitted before it is stale by definition.
  const lastEventAt = state.requestDate ?? readStartedAt;
  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      plan: state.plan ?? "unknown",
      status,
      expiresAt: state.expiresAt,
      appleTransactionId: state.transactionId,
      lastEventAt,
    },
    // Only overwrite what RevenueCat actually reported. Once an entitlement
    // is gone (lapsed, or transferred to another account) it comes back with
    // no product/expiry/transaction, and the row should keep the record of
    // what was subscribed to and when it ended - support and refund disputes
    // need it, and "expired" is already what revokes access.
    update: {
      status,
      lastEventAt,
      ...(state.plan ? { plan: state.plan } : {}),
      ...(state.expiresAt ? { expiresAt: state.expiresAt } : {}),
      ...(state.transactionId ? { appleTransactionId: state.transactionId } : {}),
    },
  });
  logStatusChange(userId, existing?.status ?? null, status, "sync");
  return state.active;
}

/**
 * One line per entitlement transition, tagged so Vercel's log search finds
 * every status flip regardless of which write path caused it. Unchanged
 * status stays silent: renewals and repeated syncs would otherwise drown it.
 * Info level on purpose: these are healthy lifecycle events, and Vercel's
 * Warning filter is reserved for the degraded paths (withheld downgrades,
 * stale conflicts, failed tiebreaks). `info` rather than `log` because the
 * structural gate (check 6) blocks new plain-log call sites.
 */
export function logStatusChange(
  userId: string,
  from: string | null,
  to: string,
  source: "sync" | "webhook",
): void {
  if (from === to) return;
  console.info(`[subscription] ${userId} status ${from ?? "none"} -> ${to} (${source})`); // eslint-disable-line no-console
}
