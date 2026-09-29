import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/subscription";

/**
 * GET /api/subscriptions/status - the server's entitlement verdict.
 *
 * The mobile client calls this on every launch and gates the app on `active`
 * (the on-device RevenueCat state is only a hint that triggers a sync). It is
 * a plain DB read of the webhook/sync-maintained `Subscription` row plus the
 * dev/demo bypass in `lib/subscription`; POST /api/subscriptions/sync is the
 * heavier path that re-reads RevenueCat first.
 *
 * Response includes the account-bound `verdict`, `lastRcVerifiedAt` and
 * `stale` fields alongside legacy `active`, raw `status` and `expiresAt`.
 * A missing row is unknown until a successful RC sync confirms whether this
 * this user has Pro history.
 *
 * Replaces the old stubbed `/api/subscriptions/verify` receipt-validation
 * endpoint - clients no longer send receipts; RevenueCat validates and notifies
 * the webhook, and this endpoint reports the resulting state.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { active, status, expiresAt, verdict, lastRcVerifiedAt, stale } = await getEntitlementStatus(auth.sub, auth.email);
  return NextResponse.json({
    active,
    status,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    verdict,
    lastRcVerifiedAt: lastRcVerifiedAt?.toISOString() ?? null,
    stale,
  });
}
