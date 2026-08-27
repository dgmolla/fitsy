/**
 * GET /api/internal/marketing/weekly
 *
 * Weekly marketing email cron — triggered every Tuesday at 16:00 UTC.
 * Picks the deterministic edition for the current week, queries all opted-in
 * users, deduplicates against a self-creating _marketing_send table, and
 * sends sequentially (no fan-out) with a 500-send cap per invocation.
 *
 * Idempotent: if the cron fires more than once in a week (e.g. retries),
 * already-sent rows are skipped and the next 500 unsent users are processed.
 * This means the cap + dedup together guarantee eventual delivery to the full
 * audience across as many invocations as needed.
 *
 * Auth: CRON_SECRET Bearer (same as all other internal cron routes).
 * DryRun: ?dryRun=1 returns stats without sending.
 * Response: { ok, edition, eligible, sent, skipped, failed }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { sendMarketingEmail } from "@/lib/marketingEmail";
import { editionForDate } from "@/lib/emailTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Maximum sends per invocation. Weekly cron + idempotent dedup means the
// next scheduled run (or a manual retry) will pick up any remainder, so
// this cap bounds Vercel function wall-time without dropping users.
const MAX_SENDS_PER_INVOCATION = 500;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // --- Auth ---
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  // --- Pick edition for this week ---
  const { slug, subject, html } = editionForDate(new Date());

  // --- Ensure dedup table exists (self-creating, no Prisma migration needed) ---
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_marketing_send" (
       edition  text        NOT NULL,
       user_id  text        NOT NULL,
       sent_at  timestamptz DEFAULT now(),
       PRIMARY KEY (edition, user_id)
     )`,
  );

  // --- Audience: all users who have not opted out ---
  // PRE-GENERATE CONSTRAINT: emailOptOutAt is not in the Prisma client type,
  // so we must use $queryRawUnsafe with an explicit row type.
  const rows = await prisma.$queryRawUnsafe<{ id: string; email: string }[]>(
    'SELECT id, email FROM "User" WHERE "emailOptOutAt" IS NULL',
  );

  const eligible = rows.length;

  if (dryRun) {
    // Count how many have already been sent this edition without sending anything
    const alreadySentRows = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM "_marketing_send" WHERE edition = $1`,
      slug,
    );
    const alreadySent = parseInt(alreadySentRows[0]?.count ?? "0", 10);
    return NextResponse.json({ ok: true, dryRun: true, edition: slug, eligible, alreadySent });
  }

  // --- Send loop ---
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    // Hard cap per invocation — remainder handled on next run
    if (sent >= MAX_SENDS_PER_INVOCATION) break;

    // Check dedup: skip if already sent to this user for this edition
    const existing = await prisma.$queryRawUnsafe<{ user_id: string }[]>(
      `SELECT user_id FROM "_marketing_send" WHERE edition = $1 AND user_id = $2 LIMIT 1`,
      slug,
      row.id,
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Attempt send
    const ok = await sendMarketingEmail({
      userId: row.id,
      to: row.email,
      subject,
      html,
    });

    if (ok) {
      // Record dedup row only after confirmed send — a failed send must be
      // retried on the next run, never silently dropped.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_marketing_send" (edition, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        slug,
        row.id,
      );
      sent++;
    } else {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, edition: slug, eligible, sent, skipped, failed });
}
