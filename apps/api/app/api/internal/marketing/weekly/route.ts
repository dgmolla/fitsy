/**
 * GET /api/internal/marketing/weekly
 *
 * Weekly marketing email cron - triggered every Tuesday at 16:00 UTC.
 * Picks the deterministic edition for the current week, loads the marketing
 * audience that has NOT yet received it (lib/marketingAudience.ts: accounts,
 * and waitlist-only addresses once the double opt-in confirmation ships,
 * minus every opt-out, minus the ledger rows for this step), and sends
 * sequentially (no fan-out).
 *
 * Idempotency and pacing come from the MarketingSend ledger
 * (lib/marketingLedger.ts). The ledger step is `<edition>:w<week>`, so an
 * edition goes to an address once per rotation (the eight editions repeat
 * every eight weeks by design) while retries within the week stay
 * idempotent. An address that heard from any marketing campaign within the
 * last 48 hours (e.g. a lifecycle step) is skipped this week rather than
 * double-mailed.
 *
 * The run is bounded by wall time (BUDGET_MS) and a hard send ceiling, not
 * paged: the cron fires once a week, so anything not sent in this run would
 * otherwise never go out. If the audience outgrows one run the response
 * carries `unsent` and Slack is told; a manual re-run resumes from the
 * ledger (already-sent addresses are excluded at query time).
 *
 * Auth: CRON_SECRET Bearer (same as all other internal cron routes).
 * DryRun: ?dryRun=1 returns stats without sending.
 * Response: { ok, edition, eligible, sent, paced, failed, unsent }
 */

import { NextRequest, NextResponse } from "next/server";
import { notifySlack } from "@fitsy/shared";
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { editionForDate, weekIndexForDate } from "@/lib/emailTemplates";
import { marketingAudience } from "@/lib/marketingAudience";
import { MAX_SENDS_PER_RUN, recordSend, sentWithin } from "@/lib/marketingLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sequential sends with provider timeouts: give the function the room it
// needs rather than dying mid-loop at the platform default.
export const maxDuration = 300;

/** Wall-clock budget for the send loop, under maxDuration with headroom. */
const BUDGET_MS = 240_000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  // --- Pick edition for this week; the ledger step is week-stamped ---
  const now = new Date();
  const { slug, subject, html } = editionForDate(now);
  const step = `${slug}:w${weekIndexForDate(now)}`;

  // Recurring email to waitlist-only addresses waits for double opt-in.
  // Addresses already recorded for this step are excluded at query time, so
  // a re-run walks only what is left.
  const audience = await marketingAudience({
    includeWaitlistOnly: false,
    excludeSent: { campaign: "weekly", step },
  });
  const eligible = audience.length;

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, edition: slug, eligible });
  }

  const started = Date.now();
  let sent = 0;
  let paced = 0;
  let failed = 0;
  let processed = 0;

  for (const r of audience) {
    if (sent >= MAX_SENDS_PER_RUN || Date.now() - started > BUDGET_MS) break;
    processed++;

    // Frequency cap across campaigns: never two marketing emails within 48h.
    if (await sentWithin(r.email)) {
      paced++;
      continue;
    }

    const recipient = r.userId !== undefined ? { userId: r.userId } : { waitlistId: r.waitlistId };
    const ok = await sendMarketingEmail({
      ...recipient,
      to: r.email,
      subject,
      html,
      idempotencyKey: `weekly:${step}:${r.email}`,
    });

    if (ok) {
      // Record only after a confirmed send - a failed send must be retried
      // on the next run, never silently dropped.
      await recordSend(r.email, "weekly", step);
      sent++;
    } else {
      failed++;
    }
  }

  // The cron has no second chance for this edition (next week is a new
  // step), so anything that did not go out must reach a human: rows not
  // reached within the budget, and rows the provider refused.
  const unsent = eligible - processed;
  if (unsent > 0 || failed > 0) {
    await notifySlack(
      failed > 0 ? "weekly editorial had failures" : "weekly editorial incomplete",
      `${slug}: sent ${sent}, paced ${paced}, failed ${failed}, ${unsent} not reached within the run budget. ` +
        `Re-run GET /api/internal/marketing/weekly to resume; already-sent addresses are excluded.`,
      { source: "marketing-weekly" },
    );
  }

  return NextResponse.json({ ok: true, edition: slug, eligible, sent, paced, failed, unsent });
}
