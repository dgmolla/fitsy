import { NextRequest, NextResponse } from "next/server";
import { postSlackMessage } from "@fitsy/shared";
import { prisma } from "@/lib/restaurantService";
import { buildFeedbackDigest } from "@/lib/feedbackDigest";

/**
 * Daily feedback round-up: collects the last 24h of Feedback rows and posts a
 * formatted digest to Slack. Triggered by Vercel Cron once a day.
 *
 * Auth: CRON_SECRET must match the Bearer token Vercel sends on cron
 * invocations (or a manual curl with the same secret for ad-hoc checks).
 *
 * Dry run: append `?dry=1` to fetch + format the digest and return it as JSON
 * WITHOUT posting to Slack. Still requires the CRON_SECRET.
 */

const WINDOW_HOURS = 24;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
  const rows = await prisma.feedback.findMany({
    where: { createdAt: { gt: since } },
    orderBy: { createdAt: "desc" },
    select: { userEmail: true, message: true, createdAt: true },
  });

  const text = buildFeedbackDigest(rows, { windowHours: WINDOW_HOURS });

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  if (dry) {
    return NextResponse.json({ ok: true, dry: true, count: rows.length, text });
  }

  const posted = await postSlackMessage(text);
  return NextResponse.json({ ok: true, count: rows.length, posted });
}
