/**
 * GET /api/internal/marketing/weekly
 *
 * Weekly marketing email cron — triggered every Tuesday at 16:00 UTC.
 * Picks the deterministic edition for the current week, loads the marketing
 * audience (accounts AND waitlist-only addresses, minus every opt-out; see
 * lib/marketingAudience.ts), and sends sequentially (no fan-out) with a
 * 500-send cap per invocation.
 *
 * Idempotency and pacing come from the MarketingSend ledger
 * (lib/marketingLedger.ts): an edition goes to an address once, ever, and an
 * address that heard from any marketing campaign within the last 48 hours
 * (e.g. a lifecycle step) is skipped this week rather than double-mailed.
 * The cap + ledger together guarantee eventual delivery to the full audience
 * across as many invocations as needed.
 *
 * Auth: CRON_SECRET Bearer (same as all other internal cron routes).
 * DryRun: ?dryRun=1 returns stats without sending.
 * Response: { ok, edition, eligible, sent, skipped, paced, failed }
 */

import { NextRequest, NextResponse } from "next/server";
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { editionForDate } from "@/lib/emailTemplates";
import { marketingAudience } from "@/lib/marketingAudience";
import { recordSend, sentWithin, wasSent } from "@/lib/marketingLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sequential sends with provider timeouts: give the function the room it
// needs rather than dying mid-loop at the platform default.
export const maxDuration = 300;

// Maximum sends per invocation. Weekly cron + idempotent ledger means the
// next scheduled run (or a manual retry) will pick up any remainder, so
// this cap bounds Vercel function wall-time without dropping anyone.
const MAX_SENDS_PER_INVOCATION = 500;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const { slug, subject, html } = editionForDate(new Date());
  const audience = await marketingAudience();
  const eligible = audience.length;

  if (dryRun) {
    let alreadySent = 0;
    for (const r of audience) if (await wasSent(r.email, "weekly", slug)) alreadySent++;
    return NextResponse.json({ ok: true, dryRun: true, edition: slug, eligible, alreadySent });
  }

  let sent = 0;
  let skipped = 0;
  let paced = 0;
  let failed = 0;

  for (const r of audience) {
    if (sent >= MAX_SENDS_PER_INVOCATION) break;

    if (await wasSent(r.email, "weekly", slug)) {
      skipped++;
      continue;
    }
    // Frequency cap across campaigns: never two marketing emails within 48h.
    if (await sentWithin(r.email)) {
      paced++;
      continue;
    }

    const recipient = r.userId !== undefined ? { userId: r.userId } : { waitlistId: r.waitlistId };
    const ok = await sendMarketingEmail({ ...recipient, to: r.email, subject, html });

    if (ok) {
      // Record only after a confirmed send — a failed send must be retried
      // on the next run, never silently dropped.
      await recordSend(r.email, "weekly", slug);
      sent++;
    } else {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, edition: slug, eligible, sent, skipped, paced, failed });
}
