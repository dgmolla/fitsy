import { NextRequest, NextResponse } from "next/server";
import { postSlackMessage } from "@fitsy/shared";
import { prisma } from "@/lib/restaurantService";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const POSTHOG_TIMEOUT_MS = 15_000;

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
    prisma.subscription.count({ where: { status: "active" } }),
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
    expiredSubscriptions,
    itemsSaved,
    feedback,
    waitlist,
    waitlistTotal,
  };
}

// ─── PostHog (HogQL) ──────────────────────────────────────────────────────────

type HogRow = Array<number | string | null>;

async function hogql(query: string): Promise<HogRow[]> {
  const key = process.env["POSTHOG_PERSONAL_API_KEY"];
  const project = process.env["POSTHOG_PROJECT_ID"];
  const host = process.env["POSTHOG_HOST"] ?? "https://us.posthog.com";
  if (!key || !project) throw new Error("not configured");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POSTHOG_TIMEOUT_MS);
  try {
    const res = await fetch(`${host}/api/projects/${project}/query/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { results?: HogRow[] };
    return json.results ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function num(v: number | string | null | undefined): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

/** One row: [thisWeek, lastWeek]. */
async function hogWeekOverWeek(expr: string, where = "1"): Promise<WeekOverWeek> {
  const rows = await hogql(
    `select
       ${expr.replace("__RANGE__", "timestamp >= now() - interval 7 day")} as this_week,
       ${expr.replace("__RANGE__", "timestamp >= now() - interval 14 day and timestamp < now() - interval 7 day")} as last_week
     from events where timestamp >= now() - interval 14 day and ${where}`,
  );
  const row = rows[0] ?? [];
  return { thisWeek: num(row[0]), lastWeek: num(row[1]) };
}

async function loadPostHogMetrics(): Promise<PostHogMetrics> {
  const [wau, searches, zeroResultSearches, d7rows] = await Promise.all([
    hogWeekOverWeek("uniqIf(person_id, __RANGE__)"),
    hogWeekOverWeek("countIf(__RANGE__)", "event = 'search_performed'"),
    hogWeekOverWeek(
      "countIf(__RANGE__ and toInt(properties.result_count) = 0)",
      "event = 'search_performed'",
    ),
    hogql(
      `select count() as cohort, countIf(last_seen >= first_seen + interval 7 day) as returned
       from (
         select person_id, min(timestamp) as first_seen, max(timestamp) as last_seen
         from events group by person_id
       )
       where first_seen >= now() - interval 21 day and first_seen < now() - interval 7 day`,
    ),
  ]);
  const d7row = d7rows[0] ?? [];
  return {
    wau,
    searches,
    zeroResultSearches,
    d7: { cohort: num(d7row[0]), returned: num(d7row[1]) },
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const db = await loadDbMetrics(now);

  let posthog: PostHogMetrics | null = null;
  let posthogNote: string | undefined;
  try {
    posthog = await loadPostHogMetrics();
  } catch (err) {
    posthogNote =
      err instanceof Error && err.message === "not configured"
        ? "set POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID"
        : `query failed (${err instanceof Error ? err.message : "unknown"})`;
  }

  const text = buildScoreboard({ weekEnding: now, db, posthog, posthogNote });

  if (req.nextUrl.searchParams.get("dry") === "1") {
    return NextResponse.json({ ok: true, dry: true, text, db, posthog, posthogNote });
  }
  const posted = await postSlackMessage(text);
  return NextResponse.json({ ok: true, posted });
}
