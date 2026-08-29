import type { PostHogMetrics, WeekOverWeek } from "@/lib/scoreboard";

/**
 * PostHog HogQL client for the weekly scoreboard (docs/gtm/la-rollout.md §
 * Weekly ritual). External API calls live in services/ per repo convention;
 * apps/api/lib/scoreboard.ts stays a pure formatter.
 */

const POSTHOG_TIMEOUT_MS = 10_000;

type HogRow = Array<number | string | null>;

export async function hogql(query: string): Promise<HogRow[]> {
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

/**
 * D7 cohort: users whose first event was 7-21 days ago, and whether they
 * came back on/after day 7.
 *
 * Bounded to a 60-day scan (not an all-time group-by) to keep this a cheap
 * query as the events table grows. The 60-day bound is acceptable: someone
 * whose true first-ever event predates the 60-day window would only show up
 * with first_seen inside our 7-21 day cohort window if they had a 39+ day
 * gap with zero events before re-appearing there - an acceptable miss for a
 * weekly ritual metric, not a correctness guarantee.
 */
async function hogD7(): Promise<{ cohort: number; returned: number }> {
  const rows = await hogql(
    `select count() as cohort, countIf(returned) as returned from (
       select person_id,
         min(timestamp) as first_seen,
         max(timestamp) >= min(timestamp) + interval 7 day as returned
       from events
       where timestamp >= now() - interval 60 day
       group by person_id
     ) where first_seen >= now() - interval 21 day and first_seen < now() - interval 7 day`,
  );
  const row = rows[0] ?? [];
  return { cohort: num(row[0]), returned: num(row[1]) };
}

/**
 * Loads the PostHog half of the weekly scoreboard.
 *
 * Throws "not configured" up front when POSTHOG_PERSONAL_API_KEY /
 * POSTHOG_PROJECT_ID are missing, so the caller can show one note for the
 * whole section. Once configured, the four underlying queries run
 * independently via Promise.allSettled so a single failing query degrades
 * to null (rendered as "n/a") for just that metric instead of dropping the
 * whole section.
 */
export async function loadPostHogMetrics(): Promise<PostHogMetrics> {
  const key = process.env["POSTHOG_PERSONAL_API_KEY"];
  const project = process.env["POSTHOG_PROJECT_ID"];
  if (!key || !project) throw new Error("not configured");

  const [wau, searches, zeroResultSearches, d7] = await Promise.allSettled([
    hogWeekOverWeek("uniqIf(person_id, __RANGE__)"),
    hogWeekOverWeek("countIf(__RANGE__)", "event = 'search_performed'"),
    hogWeekOverWeek(
      "countIf(__RANGE__ and toInt(properties.result_count) = 0)",
      "event = 'search_performed'",
    ),
    hogD7(),
  ]);

  return {
    wau: wau.status === "fulfilled" ? wau.value : null,
    searches: searches.status === "fulfilled" ? searches.value : null,
    zeroResultSearches:
      zeroResultSearches.status === "fulfilled" ? zeroResultSearches.value : null,
    d7: d7.status === "fulfilled" ? d7.value : null,
  };
}
