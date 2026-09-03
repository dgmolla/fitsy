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
 * The mobile client calls this at the moments entitlement changes hands:
 * right after a purchase or restore (so the very next search isn't racing the
 * webhook), and whenever the device's RevenueCat state says Pro while the API
 * is still serving locked responses (a subscription transferred to this
 * account from another, or a webhook delivery that never landed).
 *
 * Response: `{ active, synced }` - `synced: false` means RevenueCat couldn't
 * be consulted and `active` is the existing DB state instead.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (subscriptionBypass(auth.email)) {
    return NextResponse.json({ active: true, synced: false });
  }

  const active = await syncSubscriptionFromRevenueCat(auth.sub);
  if (active === null) {
    return NextResponse.json({
      active: await isEntitled(auth.sub, auth.email),
      synced: false,
    });
  }
  return NextResponse.json({ active, synced: true });
}
