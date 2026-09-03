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
 * transfers, webhook races and missed deliveries). This is the authoritative
 * server-side check: the mobile client's RevenueCat `isPro` drives UX/routing
 * (instant, on-device), but the API independently enforces entitlement here so
 * the paywall can't be bypassed by calling the API directly.
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
 * Authoritative entitlement check. Active iff the webhook-synced row says
 * `active` and it hasn't lapsed. Bypassed accounts are always entitled.
 */
export async function isEntitled(userId: string, email: string): Promise<boolean> {
  if (subscriptionBypass(email)) return true;
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { status: true, expiresAt: true },
  });
  if (!sub || sub.status !== "active") return false;
  if (sub.expiresAt && sub.expiresAt.getTime() < Date.now()) return false;
  return true;
}

/**
 * Require an authenticated user WITH an active subscription. Mirrors
 * `requireAuth`'s contract — returns the `JwtPayload` on success, or a
 * `NextResponse` the caller should return:
 *   - 401 if unauthenticated (delegated to `requireAuth`)
 *   - 402 `{ error: "subscription_required" }` if authenticated but not entitled
 *
 *   const auth = await requireSubscription(request);
 *   if (auth instanceof NextResponse) return auth;
 */
export async function requireSubscription(
  request: NextRequest,
): Promise<JwtPayload | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (await isEntitled(auth.sub, auth.email)) return auth;
  return NextResponse.json({ error: "subscription_required" }, { status: 402 });
}

export interface OptionalSubscriptionResult {
  payload: JwtPayload | null;
  entitled: boolean;
}

/**
 * Like `requireSubscription`, but never rejects the request — an
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

/**
 * Pull the user's current `pro` state from RevenueCat and write it to the
 * `Subscription` row, so the next `isEntitled` read reflects reality without
 * waiting for (or depending on) a webhook delivery.
 *
 * Returns the resulting entitlement, or `null` when RevenueCat couldn't be
 * consulted (not configured / unreachable) - in which case nothing is
 * written, so a transient outage can never downgrade a paying user.
 *
 * A user RevenueCat has never seen subscribe gets no row (nothing to record);
 * an existing row is updated to whatever RevenueCat says, including
 * `expired` when the entitlement moved to another account (TRANSFER).
 */
export async function syncSubscriptionFromRevenueCat(userId: string): Promise<boolean | null> {
  const state = await fetchProEntitlement(userId);
  if (!state) return null;

  const [user, existing] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.subscription.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  // No User row = nothing the FK will let us attach to (deleted account, or
  // an id we never provisioned). Report what RevenueCat says, persist nothing.
  if (!user) return state.active;
  if (!state.active && !existing) return false;

  const status = state.active ? "active" : "expired";
  const plan = state.plan ?? "unknown";
  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      plan,
      status,
      expiresAt: state.expiresAt,
      appleTransactionId: state.transactionId,
    },
    update: {
      plan,
      status,
      expiresAt: state.expiresAt,
      appleTransactionId: state.transactionId,
    },
  });
  return state.active;
}
