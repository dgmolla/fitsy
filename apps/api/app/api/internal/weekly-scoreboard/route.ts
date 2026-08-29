import { NextRequest, NextResponse } from "next/server";
import { postSlackMessage } from "@fitsy/shared";
import { prisma } from "@/lib/restaurantService";
import { loadPostHogMetrics } from "@/services/posthogService";
import {
  buildScoreboard,
  type DbMetrics,
  type PostHogMetrics,
  type WeekOverWeek,
} from "@/lib/scoreboard";

/**
 * Monday scoreboard: one Slack message with the week's acquisition,
 * activation, monetization, retention, and feedback numbers, week-over-week.
 * Triggered by Vercel Cron (Mon 14:00 UTC = 7am PT), before the weekly review.
 *
 * Auth: CRON_SECRET bearer. Dry run: `?dry=1` returns the text as JSON.
 *
 * PostHog section needs POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID
 * (optional POSTHOG_HOST, default https://us.posthog.com). Without them the
 * message says so; the DB half always posts.
 */

export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

async function weekOverWeek(
  count: (from: Date, to: Date) => Promise<number>,
  now: Date,
): Promise<WeekOverWeek> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const twoWeeksAgo = new Date(now.getTime() - 2 * WEEK_MS);
  const [thisWeek, lastWeek] = await Promise.all([
    count(weekAgo, now),
    count(twoWeeksAgo, weekAgo),
  ]);
  return { thisWeek, lastWeek };
}

async function loadDbMetrics(now: Date): Promise<DbMetrics> {
  const range = (from: Date, to: Date) => ({ gte: from, lt: to });
  const [
    totalUsers,
    signups,
    activated,
    subscriptionsStarted,
    activeSubscriptions,
    billingIssueSubscriptions,
    expiredSubscriptions,
    itemsSaved,
    feedback,
    waitlist,
    waitlistTotal,
  ] = await Promise.all([
    prisma.user.count(),
    weekOverWeek((f, t) => prisma.user.count({ where: { createdAt: range(f, t) } }), now),
    // MacroTarget has no timestamp; "activated this week" = signed up this
    // week AND finished onboarding (MacroTarget exists).
    weekOverWeek(
      (f, t) =>
        prisma.user.count({
          where: { createdAt: range(f, t), macroTarget: { isNot: null } },
        }),
      now,
    ),
    weekOverWeek(
      (f, t) => prisma.subscription.count({ where: { createdAt: range(f, t) } }),
      now,
    ),
    // Matches lib/subscription.ts's isEntitled semantics: active AND not lapsed.
    prisma.subscription.count({
      where: {
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    prisma.subscription.count({ where: { status: "billing_issue" } }),
    prisma.subscription.count({ where: { status: "expired" } }),
    weekOverWeek((f, t) => prisma.savedItem.count({ where: { createdAt: range(f, t) } }), now),
    weekOverWeek((f, t) => prisma.feedback.count({ where: { createdAt: range(f, t) } }), now),
    weekOverWeek(
      (f, t) => prisma.launchWaitlist.count({ where: { createdAt: range(f, t) } }),
      now,
    ),
    prisma.launchWaitlist.count(),
  ]);
  return {
    totalUsers,
    signups,
    activated,
    subscriptionsStarted,
    activeSubscriptions,
    billingIssueSubscriptions,
    expiredSubscriptions,
    itemsSaved,
    feedback,
    waitlist,
    waitlistTotal,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

interface PostHogResult {
  posthog: PostHogMetrics | null;
  posthogNote: string | undefined;
}

async function loadPostHogResult(): Promise<PostHogResult> {
  try {
    const posthog = await loadPostHogMetrics();
    return { posthog, posthogNote: undefined };
  } catch (err) {
    const posthogNote =
      err instanceof Error && err.message === "not configured"
        ? "set POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID"
        : `query failed (${err instanceof Error ? err.message : "unknown"})`;
    return { posthog: null, posthogNote };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const [db, { posthog, posthogNote }] = await Promise.all([
    loadDbMetrics(now),
    loadPostHogResult(),
  ]);

  const text = buildScoreboard({ weekEnding: now, db, posthog, posthogNote });

  if (req.nextUrl.searchParams.get("dry") === "1") {
    return NextResponse.json({ ok: true, dry: true, text, db, posthog, posthogNote });
  }
  const posted = await postSlackMessage(text);
  return NextResponse.json({ ok: true, posted });
}
