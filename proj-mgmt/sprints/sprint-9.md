---
kanban-plugin: basic
---

## Backlog

## In Progress

 — 3 restaurants (Chick-fil-A, McDonald's, Pollo Campero), 268 items, 268 MacroEstimates all source:"fatsecret", rating+priceLevel populated, 0 duplicates. #cto #O1 @completed(2026-04-07)

## Done

- [x] **S-89** Wipe + re-populate staging DB — 3 restaurants (Chick-fil-A, McDonald's, Pollo Campero), 268 items, 268 MacroEstimates all source:"fatsecret", rating+priceLevel populated, 0 duplicates. #cto #O1 @completed(2026-04-07)
- [x] **S-83** Wire filters in mobile UI — FiltersPanel (cuisine + dietary + price rows), doFetch wired to API params, DietaryBadges on cards. #frontend #O1 @completed(2026-04-07)
- [x] **S-81** API filter expansion — `dietary`, `maxPriceLevel`, `minRating` params added to GET /api/restaurants; `RestaurantResult` exposes rating/priceLevel/dietaryOptions. #backend #O1 @completed(2026-04-07)
- [x] **S-80** Derive restaurant dietary summary — `dietaryOptions String[]` added to Restaurant schema; `aggregateDietaryOptions` aggregates MenuItem tags (≥3 items → "has_{tag}"); scripts/constants.ts tested in CI. #backend #cto #O1 @completed(2026-04-07)
- [x] **S-78** Enrich Google Places fetch — `rating`, `userRatingCount`, `priceLevel` added to `PlaceResult`, field mask, and Restaurant upsert in both preload scripts. #backend #cto #O1 @completed(2026-04-07)
- [x] **S-79** Dietary tag extraction — Haiku system prompt requests `tags`, allowlist filter in `macroEstimationService`, `MacroData.dietaryTags`, persisted to `MenuItem.dietaryTags`. #backend #cto #O1 @completed(2026-04-07)
- [x] **S-84** Add Newsreader font — install `@expo-google-fonts/newsreader`, load in root layout. #frontend #O1 @completed(2026-04-06)
- [x] **S-85** Mockup V3-A: Editorial Cream — cream bg, deep green, Newsreader headlines, macro strip with Edit button, tonal layering. #frontend #O1 @completed(2026-04-07)
- [x] **S-86** Mockup V3-B: Editorial Cards — taller cards with asymmetric floating info panel. #frontend #O1 @completed(2026-04-07)
- [x] **S-87** Mockup V3-C: Magazine Layout — hero image, "THE MIDDAY SELECTION" masthead, dish carousel per restaurant. #frontend #O1 @completed(2026-04-07)
- [x] **S-88** Mockup V3-D: Hybrid Minimal — compact cards with glassmorphic BlurView info strip, tonal-only. #frontend #O1 @completed(2026-04-07)
- [x] **S-82** Fix MacroEstimate upsert — current preload creates duplicate MacroEstimate rows on re-run. Change to upsert (delete existing estimates for a menuItem before inserting new ones) or use `upsert` with a unique constraint on `menuItemId`. #backend #O1 @completed(2026-04-06)
- [x] **S-77** Schema migration — add `rating` (Float?), `priceLevel` (String?), `userRatingCount` (Int?) to Restaurant. Add `dietaryTags` (String[]) to MenuItem. Run `npx prisma migrate dev`. #backend #O1 @completed(2026-04-06)
- [x] **S-90** Push local main to origin — 5+ unpushed commits (v2 search, dev login fix, sprint bookkeeping). Rebase onto origin/main, resolve conflicts, push. #cto #O1 @completed(2026-04-06)


## Sprint Review

### CTO: Harness evaluation
- [ ] Run `bash scripts/harness-metrics.sh` and record results
- [ ] Identify weakest metric and root cause
- [ ] Update CLAUDE.md if architecture/conventions changed

### Product Manager: Sprint bookkeeping
- [ ] Update OKR progress in `proj-mgmt/okrs.md`
- [ ] Archive this sprint in `proj-mgmt/sprint.md`

### Human: Review and decide (hard gate — sprint does not advance without this)
- [ ] Review Sprint Summary
- [ ] Course corrections — anything to change?
- [ ] Approve or reprioritize the proposed next sprint backlog

%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
