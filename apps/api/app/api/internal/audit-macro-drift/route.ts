import { NextRequest, NextResponse } from "next/server";
import { notifySlack } from "@fitsy/shared";
import { prisma } from "@/lib/restaurantService";

/**
 * Daily drift audit: ensure denormalized macros on MenuItem still match
 * the source-of-truth in MacroEstimate. Triggered by Vercel Cron once a
 * day; alerts to Slack and returns 500 if drift is detected.
 *
 * Auth: CRON_SECRET must match the Bearer token Vercel sends on cron
 * invocations (or a manual curl with the same secret for ad-hoc checks).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // IS DISTINCT FROM treats NULL on either side as drift, so a row with a
  // missing MacroEstimate value or a missing MenuItem column will trip the
  // alert just like a numeric mismatch would.
  const driftRows = await prisma.$queryRaw<{ drift_count: bigint }[]>`
    SELECT count(*)::bigint AS drift_count
    FROM "MenuItem" m
    JOIN "MacroEstimate" e ON e."menuItemId" = m.id
    WHERE m.calories   IS DISTINCT FROM e.calories
       OR m."proteinG" IS DISTINCT FROM e."proteinG"
       OR m."carbsG"   IS DISTINCT FROM e."carbsG"
       OR m."fatG"     IS DISTINCT FROM e."fatG";
  `;
  const drift = Number(driftRows[0]?.drift_count ?? 0n);

  if (drift > 0) {
    await notifySlack(
      "macro drift detected",
      `${drift} MenuItem rows out of sync with MacroEstimate.\n` +
        `Investigate write paths that may have skipped the dual-write.`,
      { source: "audit" },
    );
    return NextResponse.json(
      { ok: false, drift_count: drift },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, drift_count: 0 });
}
