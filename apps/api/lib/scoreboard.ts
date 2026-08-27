/**
 * Weekly scoreboard: the one page reviewed every Monday during the LA-only
 * phase (docs/gtm/la-rollout.md § Weekly ritual). Pure formatter; the cron
 * route in app/api/internal/weekly-scoreboard supplies the numbers.
 *
 * Two sources:
 *   - DB (always available): signups, activation, subscriptions, saves,
 *     feedback, waitlist.
 *   - PostHog (optional): WAU, searches, zero-result searches, D7 return rate.
 *     Present only when POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID are set;
 *     otherwise the section says so instead of silently disappearing.
 */

export interface WeekOverWeek {
  thisWeek: number;
  lastWeek: number;
}

export interface DbMetrics {
  totalUsers: number;
  signups: WeekOverWeek;
  /** Users who finished onboarding (have a MacroTarget row). */
  activated: WeekOverWeek;
  /** Subscription rows created (trial starts; trial vs paid lives in RevenueCat). */
  subscriptionsStarted: WeekOverWeek;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  itemsSaved: WeekOverWeek;
  feedback: WeekOverWeek;
  waitlist: WeekOverWeek;
  waitlistTotal: number;
}

export interface PostHogMetrics {
  wau: WeekOverWeek;
  searches: WeekOverWeek;
  zeroResultSearches: WeekOverWeek;
  /** Users whose first event was 7-21 days ago and who came back on/after day 7. */
  d7: { cohort: number; returned: number };
}

export interface ScoreboardInput {
  weekEnding: Date;
  db: DbMetrics;
  posthog: PostHogMetrics | null;
  /** Human-readable reason PostHog data is absent (config vs. request failure). */
  posthogNote?: string | undefined;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function delta(w: WeekOverWeek): string {
  if (w.thisWeek === w.lastWeek) return "(no change)";
  if (w.lastWeek === 0) return "(new)";
  const pct = Math.round(((w.thisWeek - w.lastWeek) / w.lastWeek) * 100);
  const sign = pct > 0 ? "+" : "";
  return `(${sign}${pct}% vs ${w.lastWeek})`;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function line(label: string, w: WeekOverWeek): string {
  return `• ${label}: *${w.thisWeek}* ${delta(w)}`;
}

export function buildScoreboard(input: ScoreboardInput): string {
  const { db, posthog } = input;
  const out: string[] = [];

  out.push(`:bar_chart: *Weekly scoreboard — week ending ${isoDate(input.weekEnding)}*`);
  out.push("");
  out.push("*Acquisition*");
  out.push(line("Signups", db.signups));
  out.push(`• Total users: *${db.totalUsers}*`);
  out.push(line("Waitlist (out of area)", db.waitlist) + ` · total ${db.waitlistTotal}`);
  out.push("");
  out.push("*Activation*");
  out.push(
    line("Completed onboarding", db.activated) +
      ` · ${pct(db.activated.thisWeek, db.signups.thisWeek)} of signups`,
  );
  out.push(line("Items saved", db.itemsSaved));
  out.push("");
  out.push("*Monetization*");
  out.push(line("Subscriptions started", db.subscriptionsStarted));
  out.push(
    `• Active: *${db.activeSubscriptions}* · expired: ${db.expiredSubscriptions} · _trial→paid: check RevenueCat_`,
  );
  out.push("");
  out.push("*Engagement & retention*");
  if (posthog) {
    out.push(line("Weekly active users", posthog.wau));
    out.push(
      line("Searches", posthog.searches) +
        ` · zero-result ${pct(posthog.zeroResultSearches.thisWeek, posthog.searches.thisWeek)}`,
    );
    out.push(
      `• D7 return rate: *${pct(posthog.d7.returned, posthog.d7.cohort)}* (${posthog.d7.returned}/${posthog.d7.cohort} of users who joined 7-21d ago)`,
    );
  } else {
    out.push(`• _PostHog metrics unavailable: ${input.posthogNote ?? "not configured"}_`);
  }
  out.push("");
  out.push("*Feedback*");
  out.push(line("Notes received", db.feedback) + " · every one replied to within 24h?");
  out.push("");
  out.push(
    "_Exit criteria + what to do with these numbers: docs/gtm/la-rollout.md_",
  );

  return out.join("\n");
}
