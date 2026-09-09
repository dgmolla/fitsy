import { NextRequest, NextResponse } from "next/server";
import { notifySlack } from "@fitsy/shared";
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
 * Runs daily from Vercel cron and does nothing before LAUNCH_DATE_ISO
 * (lib/launch.ts, the same constant the website shows). From that day on it
 * notifies everyone within the launch radius AND every location-less website
 * signup (includeUnlocated). Later days are cheap near-no-ops because
 * notifiedAt is set per row, and they double as the resume path: a blast cut
 * short by the time budget, or signups that arrive after launch day, are
 * picked up by the next tick. The blast is processed in bounded batches
 * (lib/launchNotify.ts MAX_PER_RUN); the route keeps calling until nothing
 * remains, a batch makes no progress, or it has used most of its time.
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
  if (today < LAUNCH_DATE_ISO) {
    return NextResponse.json({ ok: true, skipped: true, today, launchDate: LAUNCH_DATE_ISO });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const opts = { ...LAUNCH_CENTER, city: LAUNCH_CITY, includeUnlocated: true, dryRun };
  const started = Date.now();
  let result = await notifyLaunch(opts);
  // Drain in batches while time allows and each batch makes progress; a
  // batch that closes no rows (provider down) would be re-processed
  // identically, so stop, report it as stalled, and leave the remainder to
  // the next tick. `failed` is the latest batch's count, not a sum: failed
  // rows are retried by every batch, so summing would count them repeatedly.
  let stalled = false;
  while (!result.dryRun && result.remaining > 0 && Date.now() - started < 200_000) {
    const next = await notifyLaunch(opts);
    if (next.dryRun) break;
    const progressed = next.notified + next.suppressed > 0;
    result = {
      ...next,
      matched: result.matched,
      viaPush: result.viaPush + next.viaPush,
      viaEmail: result.viaEmail + next.viaEmail,
      notified: result.notified + next.notified,
      suppressed: result.suppressed + next.suppressed,
    };
    if (!progressed) {
      stalled = true;
      break;
    }
  }
  // Unattended cron: a stall or failures must reach a human, not just the log.
  if (!result.dryRun && (stalled || result.failed > 0)) {
    await notifySlack(
      stalled ? "launch blast stalled" : "launch blast had failures",
      `notified ${result.notified}, suppressed ${result.suppressed}, failed ${result.failed}, remaining ${result.remaining}. ` +
        `Re-run GET /api/internal/waitlist/launch-day once the provider is healthy; rows already notified are skipped.`,
      { source: "launch-day" },
    );
  }
  return NextResponse.json({ ok: true, launchDate: LAUNCH_DATE_ISO, ...result, ...(stalled ? { stalled } : {}) });
}
