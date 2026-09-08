import { NextRequest, NextResponse } from "next/server";
import { notifyLaunch } from "@/lib/launchNotify";
import { LAUNCH_CENTER, LAUNCH_CITY, LAUNCH_DATE_ISO } from "@/lib/launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sequential sends with provider timeouts: give the function the room it
// needs rather than dying mid-loop at the platform default.
export const maxDuration = 300;

/**
 * GET /api/internal/waitlist/launch-day - the scheduled launch blast.
 *
 * Runs daily from Vercel cron and does nothing until the UTC date matches
 * LAUNCH_DATE_ISO (lib/launch.ts, the same constant the website shows). On
 * that day it notifies everyone within the launch radius AND every
 * location-less website signup (includeUnlocated), then is a no-op on every
 * later run because notifiedAt is set. A cron misfire on another day is
 * harmless; a manual re-run on launch day is idempotent. The blast is
 * processed in bounded batches (lib/launchNotify.ts MAX_PER_RUN); the route
 * keeps calling until nothing remains or it has used most of its time.
 *
 * Auth: CRON_SECRET Bearer (Vercel cron sends it). ?dryRun=1 previews.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = request.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (today !== LAUNCH_DATE_ISO) {
    return NextResponse.json({ ok: true, skipped: true, today, launchDate: LAUNCH_DATE_ISO });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const opts = { ...LAUNCH_CENTER, city: LAUNCH_CITY, includeUnlocated: true, dryRun };
  const started = Date.now();
  let result = await notifyLaunch(opts);
  // Drain in batches while time allows; anything left is picked up by a
  // manual re-run (or tomorrow's tick is a no-op, so re-run today).
  while (!result.dryRun && result.remaining > 0 && Date.now() - started < 200_000) {
    const next = await notifyLaunch(opts);
    if (next.dryRun) break;
    result = {
      ...next,
      matched: result.matched,
      viaPush: result.viaPush + next.viaPush,
      viaEmail: result.viaEmail + next.viaEmail,
      notified: result.notified + next.notified,
      suppressed: result.suppressed + next.suppressed,
      failed: result.failed + next.failed,
    };
  }
  return NextResponse.json({ ok: true, launchDate: LAUNCH_DATE_ISO, ...result });
}
