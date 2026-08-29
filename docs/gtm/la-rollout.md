# LA Rollout Plan

> **Status:** Active · **Decided:** 2026-08-26 · **Owner:** Founder
> Supersedes the top-10-metro direction in `docs/engineering/pipeline/macro-accuracy-recommendations-2026-08-16.md` § Decision 5.
> Complements `strategy.md` (positioning, flywheel) and `ugc-playbook.md` (creator mechanics).

## The decision

Launch Los Angeles only and run it as a 12-16 week test.
No new metros until the exit criteria below are met.
The release click can happen at any time; nothing in this plan requires waiting.

Why LA-only: the indie half of the catalog is unvalidated everywhere, the operational instruments are new, and one city is enough to learn whether the core loop (search → pick → eat → come back) retains and converts.

What the top-10 argument got right and we still have to handle:
out-of-area users hitting a dead end become 1-star "doesn't work in my city" reviews.
Mitigation: "Los Angeles" in the App Store subtitle and first description line, and the waitlist screen for everyone else.

## Weekly ritual

One 45-minute block every Monday.

1. Read the scoreboard Slack post (cron `/api/internal/weekly-scoreboard`, Mon 7am PT).
2. Read every feedback note from the week and confirm each got a personal reply within 24h.
3. Do the 2-3 user calls booked from last week's replies (or book them).
4. Pick the fixes: at most 3, shipped by Friday via OTA where possible.
5. Update the exit-criteria table at the bottom of this doc.

Scoreboard sections: acquisition (signups, waitlist), activation (onboarding completion, saves), monetization (subs started, active, trial→paid from RevenueCat), engagement and retention (WAU, searches, zero-result %, D7 return), feedback.
PostHog numbers need `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` in the `fitsy-api` Vercel env; the DB half posts regardless.

## Feedback loop

### Built (live in prod since 2026-08-28, #207)

- Every in-app feedback note posts to Slack instantly with a one-click `Reply` link.
  The link opens a pre-filled email that quotes their note and asks for a 10-minute call.
- The daily digest (`/api/internal/feedback-digest`) carries the same links as a safety net.
- The Monday scoreboard above.

### Rule

Reply personally to every note within 24h and ask for a call.
Under 100 users, calls are the product research; nothing in analytics replaces them.
Aim for 3 calls a week during the LA phase.

### Backlog (do in this order)

1. **Per-item "these macros look wrong" flag** on the menu item row, with the item ID attached, feeding a correction queue.
   Macro accuracy is the S2-by-default category in `feedback-triage.md`; free text in Profile is the wrong place to catch it.
2. **Search-miss capture**: `search_performed` already carries `result_count`; add coarse lat/lng and the cuisine filter so zero-result searches become the coverage backlog and the exit-criteria denominator.
3. **Native review prompt** (`StoreReview.requestReview`) on a positive moment: third saved item or second session.
   Reviews drive ASO, the only free channel with compounding returns.
4. **Install source attribution**: a `source` person property in PostHog set from a referral code or "how did you hear about us" step at onboarding, so CAC per channel is measurable.

## First users: three channels, in order

Target for weeks 1-6: 200-300 activated users, at least half from channels where we can talk to them.

### Channel 1: Trainer partner program (primary)

Independent trainers and macro coaches distribute Fitsy to their clients.
Their clients ask "what do I order at X" every week; Fitsy is the answer the trainer can hand them.
This is influencer marketing that is naturally geo-constrained, which turns the LA limitation into an advantage.

**Who, and who not.**
Commercial gyms (Equinox, 24 Hour, LA Fitness, Crunch) prohibit solicitation and their staff trainers usually can't promote outside tools.
Do not pitch through those gyms.
Target instead:

- Independent trainers at private and boutique studios, or renting space at trainer-friendly gyms.
- Online coaches based in LA whose clients are mostly local (visible from client tags and check-in posts).
- Macro and nutrition coaches (Precision Nutrition certified, RDs doing macro coaching, "macro coach" in bio).
  Best fit: they already prescribe the numbers Fitsy filters by.
- Coaches attached to CrossFit boxes, run clubs, and F45/Barry's-style communities, where the coach is the community's food authority.

**Where to find them (manual list-building; Yelp, Instagram, and Thumbtack prohibit scraping).**

1. Precision Nutrition certified coach directory, LA filter: the highest-fit list, these coaches prescribe macros.
2. TrueCoach public profiles and IDEA FitnessConnect (location search; profiles carry IG and website).
3. Yelp "personal trainers Los Angeles": solo trainers usually list their IG as the website.
4. Trainer-rent gyms, where independents cluster and the host owner is a partner in their own right: Body Builders Gym (Silver Lake, explicitly independent-trainer based), Lift Silverlake, Indigo Fitness, The Compound (Woodland Hills), Nela CrossFit (Eagle Rock). One owner conversation can introduce 5-15 trainers.
5. Run clubs (48+ free ones: Venice, Koreatown, Midnight Runners, Track Club LA); their coaches are the group's food authority.
6. Health, Fitness & Wellness Business Networking Mixer, Tue 2026-09-01, 7-10pm, 2536 Lincoln Blvd: built for trainers and online fitness founders, 1-minute pitches. The only trainer-focused LA event before Fit Expo (2027-01-23).

Pool size for context: ~8,300 W-2 fitness trainers in the LA/OC metro (BLS), plus an estimated 5-9k independents in LA County. Sixty names is not a sourcing problem; fit is.

**Sequence.**
Mixer first (warm handles), then host-gym owners (warm intros), then PN/TrueCoach names.
Engage with 2-3 of a trainer's posts over a week before the DM; warm DMs reply at 30-50% vs 5-15% cold.
Fitsy's own IG needs a few real posts before outreach starts; an active sender profile converts 3-4x better.

**The offer.**

- Free Fitsy Pro for the trainer, permanently.
- Their name on a "recommended by" line in the app later if they want it (not built; do not promise a date).
- A monthly note back to them: "12 of your clients are on Fitsy, top searches were X and Y."
  This is what makes them keep recommending it.
- Clients install the normal way and get the standard 3-day trial; per-trainer client codes are out of scope for the LA phase (decided 2026-08-29).

**How free Pro is granted (RevenueCat Granted Entitlements, no code).**

1. Trainer installs Fitsy and signs in (any method); they will hit the paywall, that is expected.
2. In the RevenueCat dashboard, find the customer (search by email or app user ID), Customer history → Grant entitlement → `pro`, duration Lifetime.
3. Access lifts on their next app open: the SDK sees `entitlements.active.pro` and the paywall gate clears (`apps/mobile/lib/purchases.ts`).
4. RevenueCat sends a `NON_RENEWING_PURCHASE` webhook with `store: PROMOTIONAL`; our webhook marks the `Subscription` row active, so the server gate (`requireSubscription`) passes too. `plan` records as `unknown` for grants; cosmetic.
5. Track it in `trainer-prospects.csv` (status → `granted`).

Grants never touch Apple billing, never charge, and can be revoked in the same screen.
Verify the whole path once on a test account before the first trainer grant; the `PROMOTIONAL` webhook path has not been exercised in prod.
Do not use `DEMO_REVIEW_EMAILS` for trainers; it needs a Vercel env edit plus a mobile OTA per person and exists for App Review only.

Do not offer cash or revenue share in the first round; it changes the relationship from "tool I recommend" to "thing I'm paid to push" and clients can tell.
This matches how coach-specific programs already work (MacroFactor steers coaches away from its cash affiliate; HRV4Training gives coaches free Pro plus free client seats).

**The pitch (DM or email, 4 lines).**

> I built an app that shows LA restaurant meals filtered by protein and calories, including the indie spots.
> Your clients probably ask you what to order when they eat out; this is the tool for that moment.
> Free for you for life, and I'll send you a monthly note on how your clients use it.
> 15 minutes on a call to show you? I'm in LA and happy to come to the studio.

**Mechanics.**

- 60 outreach → expect ~15 replies → ~8 calls → 4-5 active partners in the first month.
- Each partner sends the link to 20-50 clients; expect 30-50% to install and 60% of those to activate.
- 5 partners ≈ 60-100 activated users, all of whom have a coach reminding them to use it.
- Give each partner a client-facing text they can paste (three sentences plus the App Store link) and a 60-second screen recording.
- Track in `docs/gtm/trainer-prospects.csv`: tier, name, handle, status (cold → warmed → pitched → call → granted → active).

**Why this beats gym-floor cold approach.**
One conversation reaches 20-50 people with a trusted recommender attached, the recipients already track macros, and we get a feedback channel (the trainer hears complaints before we do).

### Channel 2: LA micro-creators and communities

- 10-20 LA fitness and food creators at 2k-20k followers.
  Filter by geotags on their last 20 posts.
  Offer a free year for one honest post; no MVC deals at this stage.
  Reuse the hook library in `ugc-playbook.md`, LA-flavored ("I macro'd 40 indie spots in Silver Lake").
- One genuinely useful Reddit post on r/FoodLosAngeles or r/LosAngeles with the data as the value and the app as the source.
- CrossFit box, run club, and climbing gym group chats: ask one member (ideally a partner trainer) to post; do not post as the founder.

### Channel 3: Meta ads (yes, but as measurement)

Run them.
They are easy, and the LA-only constraint is what Meta's radius targeting is built for.
But treat the first run as buying a CAC number and a creative read, not as the acquisition engine.

**Paid is not influencer content.**
Cal AI found that reusing subtle influencer integrations as paid ads underperformed; their paid creative went explicit (app on screen in the first seconds, text overlays, fast walkthrough, trial CTA).
Fitbod and ZOE spend the same way: screen recordings and demos dominate.
So: creator-style production (phone-shot, lo-fi), product explicit inside the first 1-3 seconds.

- Budget: **$60/day for 10 days** (~$600). $25-30/day sits under Meta's learning floor (~$50/day, ~10 installs/day) and yields ~2 installs/day at LA CPMs ($20-30), which is no signal at all.
- Targeting: 12-15 mile radius around the densest coverage, ages 22-40, manual audience (for tight geo it beats Advantage+ Audience), and tick "Don't expand audience" or Meta silently widens the radius.
- Optimize to Install or Trial Start, never Purchase; iOS purchase signal lags too long for a 10-day test.
- Creatives: 5-6 variants, all 9:16, 6-15s, plus one static for FB Feed. Angles: "the 800-calorie salad" (hidden calories), "50g protein at 5 LA spots you know" (local proof), a straight screen demo of the protein filter, and one founder-face version of the demo.
- Attribution: SKAdNetwork is useless at this volume. Give each creative its own App Store custom product page and read installs, trial starts, and paid from RevenueCat and PostHog against the two prior weeks on the scoreboard.
- Benchmarks to judge against: iOS nutrition-app CPI $3-8, trial start 18-28% of installs, trial->paid 40-55%.
- Decision rule after 10 days: continue only if blended CAC (spend / activated users from the lift) is under $15, roughly first-year revenue on the annual plan after Apple's cut.
  Otherwise stop and spend the money on trainer partners instead.

Apple Search Ads on "macro tracker", "restaurant calories", "high protein near me" is worth $20-30/day in parallel if the Apple Ads console offers LA metro targeting (it supports states and some metros; confirm before spending).
Category CPI runs $2-7 with the best install->paid of any channel (5-15%).

### Not doing during the LA phase

- VA-driven national DM outreach (95% of the audience can't use the app).
- National UGC MVC deals.
- The brand authority channel (already deferred in `brand-authority-channel.md`).
- Founder cold approach of strangers on the gym floor.

## Exit criteria for the LA-only phase

Decide at week 12 with the data; week 16 is the hard stop.

**Expand to city #2 when all of the following hold:**

| # | Criterion | Threshold | Source |
|---|-----------|-----------|--------|
| 1 | D7 return rate on organic and partner cohorts | ≥ 25% over ≥ 100 activated users | Scoreboard (PostHog) |
| 2 | D30 return rate | ≥ 12% | PostHog |
| 3 | Habit | ≥ 30% of D30-retained users search 2+ times/week | PostHog |
| 4 | Trial → paid | ≥ 20%, with 2 billing cycles observed | RevenueCat |
| 5 | Trust | macro-wrong flags < 5% of viewed items; no P0 accuracy incident in 30 days | Item flag (backlog #1), feedback |
| 6 | One repeatable channel | blended CAC < $15 and a clear plan for the same channel in city #2 | Scoreboard + channel sheet |
| 7 | Demand | ≥ 200 waitlist entries concentrated in one metro | `LaunchWaitlist` |

**Stop and rethink signal:** after 12 weeks and ≥ 150 activated users, D30 < 5% or trial→paid < 8% regardless of channel.
That means the loop isn't working and another city won't fix it.

**Status (update every Monday):**

| Week | Activated | D7 | D30 | Trial→paid | Zero-result % | Partners | CAC | Notes |
|------|-----------|----|-----|------------|---------------|----------|-----|-------|
| 0 | | | | | | | | Not yet released |

## Before the release click

- [ ] App Store subtitle and first description line say "Los Angeles".
- [x] Set `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` in `fitsy-api` (Vercel) so the scoreboard has retention. Done 2026-08-26, verified in prod.
- [ ] Trainer sheet with 60 names; first 20 pitches sent the day of release.
- [ ] Five or six Meta creatives recorded (product on screen by second 3); campaign at $60/day built and paused, "Don't expand audience" ticked; one custom product page per creative.
- [ ] Tue 2026-09-01: Health/Fitness/Wellness mixer, 2536 Lincoln Blvd, 7-10pm; bring QR cards.
- [ ] Release on a Tuesday or Wednesday morning, not a Friday.
