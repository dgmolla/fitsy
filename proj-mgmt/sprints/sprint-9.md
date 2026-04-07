---
kanban-plugin: basic
---

## Backlog

- [ ] **S-78** Enrich Google Places fetch — request `rating`, `userRatingCount`, `priceLevel` fields in googlePlacesService.ts field mask. Store on Restaurant during preload. #backend #O1 ^dep-S-77
- [ ] **S-79** Dietary tag extraction — update macroEstimationService to return dietary tags (vegan, vegetarian, gluten-free, keto, dairy-free) alongside macro estimates. Haiku analyzes item name + description. Store as `MenuItem.dietaryTags[]`. #backend #O1 ^dep-S-77
- [ ] **S-80** Derive restaurant dietary summary — after preload, compute `Restaurant.dietaryOptions[]` by aggregating MenuItem dietary tags (e.g., if ≥3 vegan items → "has_vegan"). Add `dietaryOptions` (String[]) to Restaurant schema. #backend #O1 ^dep-S-79
- [ ] **S-81** API filter expansion — add query params to GET /api/restaurants: `dietary` (string, filter by dietaryOptions), `maxPriceLevel` (string, "$"–"$$$$"), `minRating` (number). Update restaurantService.ts Prisma where clause. #backend #O1 ^dep-S-80
- [ ] **S-89** Wipe + re-populate staging DB — truncate Restaurant, MenuItem, MacroEstimate tables. Run full preload pipeline with enriched fields (rating, priceLevel, dietary tags, FatSecret source). Verify data: new fields populated, no duplicates, FatSecret chains have `source: "fatsecret"`. #cto #O1 ^dep-S-78 ^dep-S-79 ^dep-S-82
- [ ] **S-83** Wire filters in mobile UI — connect cuisine filter bubbles + add dietary/price filters to the search screen. Fetch with new API params. Show dietary badges on cards. #frontend #O1 ^dep-S-81 ^dep-S-82
- [ ] **S-85** Mockup V3-A: Editorial Cream — retheme current V2 with cream bg (#fcf9f8), deeper forest green (#012d1d), Newsreader headlines, compact macro strip with "Edit" button, tonal layering (no borders). Keep current card layout + cuisine filter bubbles. Ref: `/tmp/stitch-fitsy/DESIGN.md`. Preview in simulator, screenshot, post to Slack. #frontend #O1 ^dep-S-84
- [ ] **S-86** Mockup V3-B: Editorial Cards — cream bg + taller restaurant cards with asymmetric info overlay (Stitch "Editorial Float" style). Cuisine bubbles + macro strip. Each restaurant gets a hero image with floating info panel overlapping bottom corner. Preview in simulator, screenshot, post to Slack. #frontend #O1 ^dep-S-84
- [ ] **S-87** Mockup V3-C: Magazine Layout — full editorial treatment. Large hero image for top restaurant, "The Midday Selection" Newsreader headline, dish carousel below each restaurant, section headers in italic serif. Closest to Stitch design but with fitsy branding + cuisine filters. Preview in simulator, screenshot, post to Slack. #frontend #O1 ^dep-S-84
- [ ] **S-88** Mockup V3-D: Hybrid Minimal — cream bg + compact horizontal cards (current V2 size) but with glassmorphic info overlay, macro strip, tonal layering only (no borders/shadows). Lightest editorial touch. Preview in simulator, screenshot, post to Slack. #frontend #O1 ^dep-S-84

## In Progress



## Done

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
