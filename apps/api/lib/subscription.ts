import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";
import type { JwtPayload } from "@/services/authService";

/**
 * Server-trusted subscription gate.
 *
 * Entitlement state is synced into the `Subscription` table by the RevenueCat
 * webhook (`apps/api/app/api/revenuecat/webhook`). This is the authoritative
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
