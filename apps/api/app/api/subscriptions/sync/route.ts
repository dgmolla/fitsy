import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  isEntitled,
  subscriptionBypass,
  syncSubscriptionFromRevenueCat,
} from "@/lib/subscription";

/**
 * POST /api/subscriptions/sync - refresh this user's server-side entitlement
 * straight from RevenueCat.
 *
 * The mobile client calls this at the moments entitlement can change hands:
 * right after a purchase or restore (so the very next search isn't racing the
 * webhook), on every sign-in (a returning user's row may exist while the
 * device SDK is fresh, or vice versa), and whenever the device's RevenueCat
 * state says Pro while the API is still serving locked responses (a
 * subscription transferred to this account from another, or a webhook
 * delivery that never landed). Plain launches use the cheaper GET
 * /api/subscriptions/status instead.
 *
 * Body (optional): `{ reason }` - why the client is syncing. For `purchase`
 * and `restore` the server never persists a downgrade (RevenueCat's REST
 * view can lag StoreKit by seconds): an inactive read is retried briefly
 * and, if still inactive, nothing is written. Unknown reasons are ignored.
 *
 * Response: `{ active, synced }` - `synced: false` means nothing was written
 * (RevenueCat couldn't be consulted, or a downgrade was withheld) and
 * `active` is the existing DB state instead.
 */
const NEVER_DOWNGRADE_REASONS = new Set(["purchase", "restore"]);

// The purchase/restore retry loop (up to ~6 s of re-reads, each with an 8 s
// RevenueCat timeout) can outlive Vercel's 10 s default. A kill after a
// successful final read but before the upsert would lose the write, so give
// it the same headroom as the webhook.
export const maxDuration = 30;

async function readReason(request: NextRequest): Promise<string | null> {
  try {
    const body = (await request.json()) as { reason?: unknown } | null;
    return typeof body?.reason === "string" ? body.reason : null;
  } catch {
    return null; // no body, or not JSON: a plain sync
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (subscriptionBypass(auth.email)) {
    return NextResponse.json({ active: true, synced: false });
  }

  const reason = await readReason(request);
  const active = await syncSubscriptionFromRevenueCat(auth.sub, {
    neverDowngrade: reason !== null && NEVER_DOWNGRADE_REASONS.has(reason),
  });
  if (active === null) {
    return NextResponse.json({
      active: await isEntitled(auth.sub, auth.email),
      synced: false,
    });
  }
  return NextResponse.json({ active, synced: true });
}
