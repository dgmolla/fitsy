import { buildScoreboard, type DbMetrics, type PostHogMetrics } from "./scoreboard";

const DB: DbMetrics = {
  totalUsers: 120,
  signups: { thisWeek: 20, lastWeek: 10 },
  activated: { thisWeek: 15, lastWeek: 8 },
  subscriptionsStarted: { thisWeek: 4, lastWeek: 0 },
  activeSubscriptions: 9,
  billingIssueSubscriptions: 1,
  expiredSubscriptions: 2,
  itemsSaved: { thisWeek: 33, lastWeek: 40 },
  feedback: { thisWeek: 3, lastWeek: 3 },
  waitlist: { thisWeek: 12, lastWeek: 5 },
  waitlistTotal: 40,
};

const PH: PostHogMetrics = {
  wau: { thisWeek: 50, lastWeek: 45 },
  searches: { thisWeek: 200, lastWeek: 150 },
  zeroResultSearches: { thisWeek: 20, lastWeek: 10 },
  d7: { cohort: 20, returned: 5 },
};

const WEEK = new Date("2026-09-07T14:00:00.000Z");

describe("buildScoreboard", () => {
  it("renders week-over-week deltas, ratios, and the retention block", () => {
    const text = buildScoreboard({ weekEnding: WEEK, db: DB, posthog: PH });
    expect(text).toContain("week ending 2026-09-07");
    expect(text).toContain("Signups: *20* (+100% vs 10)");
    expect(text).toContain("Items saved: *33* (-17% vs 40)");
    expect(text).toContain("Subscription rows created: *4* (new)");
    expect(text).toContain("(first-time only; trial->paid and resubscribes: RevenueCat)");
    expect(text).toContain("Notes received: *3* (no change)");
    expect(text).toContain("75% of signups");
    expect(text).toContain("zero-result 10%");
    expect(text).toContain("D7 return rate: *25%* (5/20");
    expect(text).toContain("Active: *9* · billing issue: 1 · expired: 2");
  });

  it("explains a missing PostHog section instead of dropping it", () => {
    const text = buildScoreboard({
      weekEnding: WEEK,
      db: DB,
      posthog: null,
      posthogNote: "set POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID",
    });
    expect(text).toContain("PostHog metrics unavailable: set POSTHOG_PERSONAL_API_KEY");
    expect(text).not.toContain("D7 return rate");
  });

  it("never divides by zero", () => {
    const zero: DbMetrics = {
      ...DB,
      signups: { thisWeek: 0, lastWeek: 0 },
      activated: { thisWeek: 0, lastWeek: 0 },
    };
    const text = buildScoreboard({ weekEnding: WEEK, db: zero, posthog: null });
    expect(text).toContain("Signups: *0* (no change)");
    expect(text).toContain("n/a of signups");
  });

  it("treats a rounded-to-zero percent change as no change", () => {
    const nearlyFlat: DbMetrics = {
      ...DB,
      signups: { thisWeek: 1004, lastWeek: 1000 },
    };
    const text = buildScoreboard({ weekEnding: WEEK, db: nearlyFlat, posthog: null });
    expect(text).toContain("Signups: *1004* (no change)");
  });

  it("prints n/a for individual PostHog metrics that failed while others succeeded", () => {
    const partial: PostHogMetrics = {
      wau: null,
      searches: PH.searches,
      zeroResultSearches: null,
      d7: null,
    };
    const text = buildScoreboard({ weekEnding: WEEK, db: DB, posthog: partial });
    expect(text).toContain("Weekly active users: n/a");
    expect(text).toContain("Searches: *200* (+33% vs 150) · zero-result n/a");
    expect(text).toContain("D7 return rate: n/a");
  });
});
