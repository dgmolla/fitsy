# LA launch readiness check

**TL;DR:** None of the four launch checks is fully proven for a new LA user; keep the Reels launch clock stopped.

> **Status:** Read-only assessment · **Last verified:** 2026-11-03 (America/Los_Angeles) · **Scope:** issue #727, branch `codex/mkt-727`
> PASS means the requested condition was demonstrated for the intended launch path; FAIL includes a missing observation, not necessarily a demonstrated product defect.
> This report changes no app, service, catalog, store, analytics, or audience state.

| Check | Result | Evidence limit | Smallest proposed fix before launch |
| --- | --- | --- | --- |
| Silver Lake and Hollywood coverage | **FAIL - partial evidence** | DEV macro counts are measured; dish suitability and release access remain unverified. | Inspect usable independent dishes in the intended release and address confirmed gaps. |
| New-user install path | **FAIL** | The public web CTA leads to a waitlist, with no verified installation route. | Verify an external TestFlight invitation and fresh-user install, then route the CTA to it. |
| Current launch-build price | **FAIL - unverified** | The last documented US prices are historical, and the current offering was not observed. | Compare the selected US offering, paywall, and Apple sheet with the documented prices. |
| Two distinct activity days per week for two weeks | **FAIL for the full launch metric** | Existing events support a proxy, but the complete cohort rule is not observable. | Validate ingestion and identity, then join a conservative query to private eligibility and response evidence. |

## Coverage measurement to complete

The [strategy](la-launch-strategy.md#four-week-experiment) calls for the same three-mile radius around each candidate area and, for a selected area, five independent venues and ten usable main dishes across three cuisines.
Those are launch thresholds, not measured inventory.
The existing authenticated Vercel CLI supplied the `fitsy-api` Preview configuration on 2026-11-03.
The database and Supabase origins matched the repository's DEV project identity before either query ran.
Both bounded aggregate queries ran in transactions confirmed `transaction_read_only = on`, with a ten-second statement timeout, and returned no venue names or user records.
The historic catalog and synthetic seed were not used as current counts.
For a later audit, use the installed `vercel link --cwd <private-task-scratch> --yes --project fitsy-api --non-interactive` and `vercel env pull <private-task-scratch>/preview.env --environment=preview --cwd <private-task-scratch> --yes --non-interactive` against the existing project.
Keep that scratch untracked under the task worktree, check the linked project identity, and validate both database and Supabase targets against the repository DEV identity with [the database guard](../../scripts/lib/db-target-guard.ts) before opening a connection.
Never print the pulled values or connection URL; remove the private scratch after the aggregate and do not run the environment-writing setup script.
The centroids below come from the app's [location presets](../../apps/mobile/lib/locations.ts); they approximate neighborhoods and are not administrative boundaries.
The [schema](../../prisma/schema.prisma) stores venue coordinates and active `MenuItem` macro snapshots.
An active item with non-null calories, protein, carbs, and fat is counted as having a macro estimate; this does not prove serving accuracy, appealing dish quality, or successful in-app access.

| Three-mile area | All DEV venues | Venues with at least one active complete-macro item | Independent venues with macros | Active items with complete macros | Venues without active items |
| --- | ---: | ---: | ---: | ---: | ---: |
| Silver Lake | 264 | 239 | 184 | 17,421 | 25 |
| Hollywood | 55 | 50 | 34 | 4,294 | 5 |

The first aggregate was equivalent to the query below; a companion per-venue aggregate found that all 25 Silver Lake and five Hollywood gap venues had no active menu items.
Among venues with active items, none had only partial or missing macro snapshots in this DEV read.
The counts are DEV database observations, not verified inventory in the launch build.
The query should be repeated before launch against the then-current DEV target, with the same read-only safeguards.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
WITH centers(name, lat, lng) AS (
  VALUES ('Silver Lake', 34.0868, -118.2706),
         ('Hollywood', 34.0928, -118.3287)
), nearby AS (
  SELECT c.name AS area, r.id, r."chainFlag", m.id AS item_id,
         m.calories, m."proteinG", m."carbsG", m."fatG"
  FROM centers c
  LEFT JOIN "Restaurant" r ON r."menuKind" = 'restaurant'
    AND 3958.7613 * acos(least(1.0, greatest(-1.0,
      sin(radians(c.lat)) * sin(radians(r.lat)) +
      cos(radians(c.lat)) * cos(radians(r.lat)) *
      cos(radians(r.lng - c.lng))))) <= 3
  LEFT JOIN "MenuItem" m ON m."restaurantId" = r.id AND m."retiredAt" IS NULL
)
SELECT area,
       count(DISTINCT id) AS all_venues,
       count(DISTINCT id) FILTER (WHERE item_id IS NOT NULL AND
         calories IS NOT NULL AND "proteinG" IS NOT NULL AND
         "carbsG" IS NOT NULL AND "fatG" IS NOT NULL) AS venues_with_macros,
       count(DISTINCT id) FILTER (WHERE "chainFlag" = false AND
         item_id IS NOT NULL AND calories IS NOT NULL AND
         "proteinG" IS NOT NULL AND "carbsG" IS NOT NULL AND
         "fatG" IS NOT NULL) AS independent_venues_with_macros,
       count(DISTINCT item_id) AS active_items,
       count(DISTINCT item_id) FILTER (WHERE calories IS NOT NULL AND
         "proteinG" IS NOT NULL AND "carbsG" IS NOT NULL AND
         "fatG" IS NOT NULL) AS active_items_with_macros
FROM nearby GROUP BY area ORDER BY area;
ROLLBACK;
```

**Gaps still unknown:** independent status quality, main-dish suitability, cuisine diversity, freshness, and whether the intended build serves those records.
`count(DISTINCT id)` counts each restaurant once within each area, while overlapping three-mile circles may count the same restaurant in both area rows.
The smallest follow-up is a manual in-app sample by the existing catalog owner, followed by filling any confirmed venue, menu, or macro gap.

## Install and price evidence limits

The [web CTA constant](../../apps/api/lib/appLinks.ts) currently targets the waitlist, and the [landing page](../../apps/api/app/page.tsx) says "Join the waitlist."
The live `https://fitsy.org/` homepage returned HTTP 200 on 2026-11-03, but its delivered HTML had no `testflight.apple.com/join/` or `apps.apple.com/` link.
The public Apple lookup used for this check is `https://itunes.apple.com/lookup?bundleId=com.fitsy.mobile&country=us` (HTTP 200, `resultCount: 0`, retrieved 2026-11-03); the [bundle identifier](../../apps/mobile/app.config.ts) is `com.fitsy.mobile`.
This only rules out a matching public US listing in that lookup at the time of the check; it does not inspect App Store Connect or private beta groups.
A private TestFlight invitation may exist, but its eligibility, capacity, build, and new-user installation were not verified.
Apple's [external TestFlight instructions](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers) (retrieved 2026-11-03) require an available external build and group before a public invitation can install it.
The distribution owner should confirm a working invitation, route the CTA to it, and prove installation with a fresh user before publishing any Reels CTA.

The [pricing record](../product/business-model.md#pricing-decision-record) records US **$7.99/month** and **$39.99/year** from a 2026-10-01 App Store Connect check.
The [payment screen](../../apps/mobile/app/welcome/payment.tsx) uses the current RevenueCat offering, and [purchase terms](../../apps/mobile/lib/purchaseTerms.ts) take the product's live localized price and billing period.
RevenueCat's [offering documentation](https://www.revenuecat.com/docs/getting-started/displaying-products) (retrieved 2026-11-03) says the current offering can differ by customer targeting or experiment.
Apple's [subscription documentation](https://developer.apple.com/app-store/subscriptions/) (retrieved 2026-11-03) permits prices by storefront and scheduled changes.
The October record therefore cannot certify the effective November US offer or trial eligibility.
No current launch-build offering, US storefront purchase sheet, or customer eligibility was observed on 2026-11-03.
The distribution owner should verify both selected product prices and the Apple confirmation sheet, then correct configuration or launch copy if they differ.

## Analytics query and interpretation

The [mobile event source](../../apps/mobile/lib/analytics.ts) identifies authenticated users and records the listed exploration events; [privacy filtering](../../apps/mobile/lib/analyticsPrivacy.ts) preserves IDs but strips location and nutrition fields.
The [existing API queries](../../apps/api/services/posthogService.ts) use `person_id` for WAU and D7.
The client defines `search_performed`, `restaurant_tapped`, `restaurant_detail_viewed`, `menu_item_tapped`, and successful `item_saved` events.
No PostHog project query or ingestion check was available on 2026-11-03.
The client disables GeoIP, and a menu-item tap occurs before the locked-access branch.
PostHog [documents HogQL and SQL insights](https://posthog.com/docs/sql) and [week/date expressions](https://posthog.com/docs/sql/expressions) (retrieved 2026-11-03).
The query below is a **proposed, unexecuted conservative proxy**: it counts identified people with a successful `item_saved` `save` event on at least two distinct Los Angeles calendar days in each of the last two completed Monday-Sunday weeks.
Its outer result is aggregate only; a person-level export would require separate private handling.

```sql
WITH toStartOfWeek(toTimeZone(now(), 'America/Los_Angeles'), 1) AS current_week
SELECT count() AS two_week_save_users
FROM (
  SELECT person_id
  FROM (
    SELECT person_id,
           toStartOfWeek(toTimeZone(timestamp, 'America/Los_Angeles'), 1) AS week_start,
           countDistinct(toDate(toTimeZone(timestamp, 'America/Los_Angeles'))) AS active_days
    FROM events
    WHERE timestamp >= current_week - interval 14 day
      AND timestamp < current_week
      AND event = 'item_saved'
      AND properties.action = 'save'
      AND person_id IS NOT NULL
    GROUP BY person_id, week_start
  )
  GROUP BY person_id
  HAVING countIf(active_days >= 2) = 2 AND countDistinct(week_start) = 2
)
```

The query needs a real PostHog run to verify syntax, ingestion, identity stitching, and project timezone behavior.
It undercounts restaurant or dish explorers who never save, while broader `restaurant_detail_viewed` or `menu_item_tapped` would admit locked or teaser interactions.
No event establishes LA residence, usable access throughout both weeks, a positive "would miss fitsy" answer, or a concrete meal-choice example.
The [strategy's private weekly confirmation](la-launch-strategy.md#one-metric) must supply those conditions, with consent and staff/test exclusion, before the ten-user target can be reported.
