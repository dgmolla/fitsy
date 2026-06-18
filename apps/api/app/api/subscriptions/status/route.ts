import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isEntitled } from "@/lib/subscription";

/**
 * GET /api/subscriptions/status — server-trusted entitlement check.
 *
 * The mobile client calls this to make the "must subscribe to enter the app"
 * decision server-side rather than trusting only the on-device RevenueCat
 * state. Reads the webhook-synced `Subscription` table and honors the dev/demo
 * bypass in `lib/subscription`.
 *
 * Replaces the old stubbed `/api/subscriptions/verify` receipt-validation
 * endpoint — clients no longer send receipts; RevenueCat validates and notifies
 * the webhook, and this endpoint reports the resulting state.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const active = await isEntitled(auth.sub, auth.email);
  return NextResponse.json({ active });
}
