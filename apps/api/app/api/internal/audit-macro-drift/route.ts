import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { notifySlack, macroWinnerSqlOrder } from "@fitsy/shared";
import { prisma } from "@/lib/restaurantService";

/**
 * Daily drift audit: ensure denormalized macros on MenuItem still match
 * the WINNING MacroEstimate for each item. Triggered by Vercel Cron once a
 * day; alerts to Slack and returns 500 if drift is detected.
 *
 * Auth: CRON_SECRET must match the Bearer token Vercel sends on cron
 * invocations (or a manual curl with the same secret for ad-hoc checks).
 *
 * With provenance (multiple estimates per item keyed by source), we compare
 * MenuItem against the single WINNING estimate (lowest trust-rank, most
 * recent tiebreak) rather than an arbitrary joined row. IS DISTINCT FROM
 * treats NULL on either side as drift.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Pick the winner per item via DISTINCT ON, then compare with IS DISTINCT FROM.
  // macroWinnerSqlOrder provides the canonical CASE ordering so SQL and TS
  // pick the same winner.
  const driftRows = await prisma.$queryRaw<{ drift_count: bigint }[]>`
    SELECT count(*)::bigint AS drift_count
    FROM "MenuItem" m
    JOIN LATERAL (
      SELECT e.calories, e."proteinG", e."carbsG", e."fatG"
      FROM "MacroEstimate" e
      WHERE e."menuItemId" = m.id
      ORDER BY ${Prisma.raw(macroWinnerSqlOrder("e"))}
      LIMIT 1
    ) winner ON true
    WHERE m.calories   IS DISTINCT FROM winner.calories
       OR m."proteinG" IS DISTINCT FROM winner."proteinG"
       OR m."carbsG"   IS DISTINCT FROM winner."carbsG"
       OR m."fatG"     IS DISTINCT FROM winner."fatG"
  `;
  const drift = Number(driftRows[0]?.drift_count ?? 0n);

  if (drift > 0) {
    await notifySlack(
      "macro drift detected",
      `${drift} MenuItem rows out of sync with the winning MacroEstimate.\n` +
        `Investigate write paths that may have skipped the dual-write or winner-recompute step.`,
      { source: "audit" },
    );
    return NextResponse.json(
      { ok: false, drift_count: drift },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, drift_count: 0 });
}
