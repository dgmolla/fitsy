import { NextRequest, NextResponse } from "next/server";
import { notifySlack } from "@fitsy/shared";
import { MAX_NOTIFY_ATTEMPTS, notifyLaunch } from "@/lib/launchNotify";
import { LAUNCH_CENTER, LAUNCH_CITY, LAUNCH_DATE_ISO } from "@/lib/launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sequential sends with provider timeouts: give the function the room it
// needs rather than dying mid-loop at the platform default.
export const maxDuration = 300;

/** Wall-clock budget for the drain; a further batch only starts if it fits. */
const BUDGET_MS = 240_000;

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
 * remains, a batch makes no progress, or another batch would not fit in the
 * time budget. A row that failed is not retried within the same run
 * (RETRY_COOLDOWN_MS in lib/launchNotify.ts), so the drain only ever walks
 * forward and every counter is a plain sum across batches.
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
  let batchStart = started;
  let result = await notifyLaunch(opts);
  let lastBatchMs = Date.now() - batchStart;
  // Drain while unprocessed rows remain, each batch makes progress, and a
  // whole further batch fits in the budget. Every counter is summed across
  // batches: with the retry cooldown a failed row is never re-attempted in
  // this run, so nothing is double counted. A batch that moves no row out
  // of the pending set (provider down) would repeat identically, so stop
  // and report it as stalled; the next tick resumes.
  let stalled = false;
  while (!result.dryRun && result.remaining > 0 && Date.now() - started + lastBatchMs < BUDGET_MS) {
    batchStart = Date.now();
    const next = await notifyLaunch(opts);
    lastBatchMs = Date.now() - batchStart;
    if (next.dryRun) break;
    const progressed = next.notified + next.suppressed + next.exhausted > 0;
    result = {
      ...next,
      matched: result.matched,
      viaPush: result.viaPush + next.viaPush,
      viaEmail: result.viaEmail + next.viaEmail,
      notified: result.notified + next.notified,
      suppressed: result.suppressed + next.suppressed,
      failed: result.failed + next.failed,
      exhausted: result.exhausted + next.exhausted,
    };
    if (!progressed) {
      stalled = true;
      break;
    }
  }
  // Unattended cron: a stall, failures, exhausted rows, or work left over
  // when the time budget ran out must reach a human, not just the log.
  if (
    !result.dryRun &&
    (stalled || result.failed > 0 || result.exhausted > 0 || result.remaining > 0)
  ) {
    const title = stalled
      ? "launch blast stalled"
      : result.failed > 0 || result.exhausted > 0
        ? "launch blast had failures"
        : "launch blast incomplete";
    await notifySlack(
      title,
      `notified ${result.notified}, suppressed ${result.suppressed}, failed ${result.failed}, ` +
        `exhausted ${result.exhausted} (gave up after ${MAX_NOTIFY_ATTEMPTS} attempts), remaining ${result.remaining}. ` +
        `Re-run GET /api/internal/waitlist/launch-day once the provider is healthy; rows already notified are skipped.`,
      { source: "launch-day" },
    );
  }
  return NextResponse.json({ ok: true, launchDate: LAUNCH_DATE_ISO, ...result, ...(stalled ? { stalled } : {}) });
}
