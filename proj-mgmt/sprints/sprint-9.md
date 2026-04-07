---
kanban-plugin: basic
---

## Backlog

- [ ] **S-77** Schema migration — add `rating` (Float?), `priceLevel` (String?), `userRatingCount` (Int?) to Restaurant. Add `dietaryTags` (String[]) to MenuItem. Run `npx prisma migrate dev`. #backend #O1
- [ ] **S-78** Enrich Google Places fetch — request `rating`, `userRatingCount`, `priceLevel` fields in googlePlacesService.ts field mask. Store on Restaurant during preload. #backend #O1 ^dep-S-77
- [ ] **S-79** Dietary tag extraction — update macroEstimationService to return dietary tags (vegan, vegetarian, gluten-free, keto, dairy-free) alongside macro estimates. Haiku analyzes item name + description. Store as `MenuItem.dietaryTags[]`. #backend #O1 ^dep-S-77
- [ ] **S-80** Derive restaurant dietary summary — after preload, compute `Restaurant.dietaryOptions[]` by aggregating MenuItem dietary tags (e.g., if ≥3 vegan items → "has_vegan"). Add `dietaryOptions` (String[]) to Restaurant schema. #backend #O1 ^dep-S-79
- [ ] **S-81** API filter expansion — add query params to GET /api/restaurants: `dietary` (string, filter by dietaryOptions), `maxPriceLevel` (string, "$"–"$$$$"), `minRating` (number). Update restaurantService.ts Prisma where clause. #backend #O1 ^dep-S-80
- [ ] **S-82** Run preload with enrichments — run full preload pipeline against staging DB with new fields (rating, priceLevel, dietary tags). Verify data populated correctly. #cto #O1 ^dep-S-78 ^dep-S-79
- [ ] **S-83** Wire filters in mobile UI — connect cuisine filter bubbles + add dietary/price filters to the search screen. Fetch with new API params. Show dietary badges on cards. #frontend #O1 ^dep-S-81 ^dep-S-82

## In Progress


## Done


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
