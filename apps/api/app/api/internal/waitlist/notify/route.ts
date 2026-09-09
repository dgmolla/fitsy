import { NextRequest, NextResponse } from "next/server";
import { notifyLaunch } from "@/lib/launchNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sequential sends with provider timeouts: give the function the room it
// needs rather than dying mid-loop at the platform default.
export const maxDuration = 300;

/**
 * POST /api/internal/waitlist/notify - operator-triggered city launch blast.
 *
 * Thin wrapper over lib/launchNotify.ts (see there for matching and channel
 * rules). The launch-day cron (GET /api/internal/waitlist/launch-day) calls
 * the same function with the configured launch center.
 *
 * Auth: CRON_SECRET Bearer (same as other internal endpoints).
 * Body: { lat, lng, radiusMiles?, city?, includeUnlocated?, dryRun? }
 * Response: { ok, matched, viaPush, viaEmail, notified, suppressed, failed, remaining }
 * Re-run while `remaining` > 0; rows already notified are skipped.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = request.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { lat, lng, radiusMiles, city, includeUnlocated, dryRun } = (body ?? {}) as {
    lat?: number;
    lng?: number;
    radiusMiles?: number;
    city?: string;
    includeUnlocated?: boolean;
    dryRun?: boolean;
  };
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json(
      { error: "lat and lng (launch center) are required" },
      { status: 400 },
    );
  }

  const result = await notifyLaunch({ lat, lng, radiusMiles, city, includeUnlocated, dryRun });
  return NextResponse.json({ ok: true, ...result });
}
