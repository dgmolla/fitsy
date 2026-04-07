---
kanban-plugin: basic
---

## Backlog

## In Progress


## Done

- [x] **S-76** Re-run hero eval with two-path pipeline — FatSecret matched 24/64→104/160 chain items after matching fix, MdAPE 3.52→5.13%. FatSecret wins 59/104 vs Haiku. Removed dead FFNSource (site now JS-rendered). #cto #O1 ^dep-S-75 @completed(2026-04-06)
- [x] **S-75** Two-path estimation — add FatSecretSource to resolver chain, update preload.ts with two-path strategy. Chains get official macros, indies get Haiku + descriptions. #cto #O1 ^dep-S-74 @completed(2026-04-05)
- [x] **S-74** Add FatSecret source — `fatSecretSource.ts` HTML parser for ~1,060 chains. 23 unit tests with cached HTML fixture. PR #108. #backend #O1 @completed(2026-04-05)
- [x] **S-72** Hero eval — primary benchmark for new pipeline. UE structured context → Haiku vs FFN ground truth. #backend #O1 ^dep-S-71 @completed(2026-04-05)
- [x] **S-71** Refactor preload.ts — thin orchestrator using service imports. Schema migration for `MacroEstimate.source`, `MenuItem.section`, `Restaurant.menuSourceId`. #backend #O1 @completed(2026-04-05)
- [x] **S-73** FFN parser validation — 10 chains, 0% calorie error against hand-curated fixtures. #backend #O1 @completed(2026-04-05)
- [x] **S-70** Build macro estimation service — `macroEstimationService.ts`, `(MacroData | null)[]` positional contract, 17 unit tests. #backend #O1 @completed(2026-04-05)
- [x] **S-69** Build MenuSource modules — `types.ts`, `ffnSource.ts`, `uberEatsSource.ts`, `resolver.ts`. 50 unit tests with cached HTML fixtures. #backend #O1 @completed(2026-04-05)
- [x] **S-62** Fix saved meals — debug BookmarkButton → POST /api/saved-items flow, fix root cause. #frontend #backend #O1 @completed(2026-03-29)
- [x] **S-63** Fix auth — restrict sign-in to Apple and Gmail only. #frontend #backend #O1 @completed(2026-03-29)
- [x] **S-59** Saved meals — Saved tab, BookmarkButton, GET/POST/DELETE /api/saved-items. #backend #frontend #O1 @completed(2026-03-28)
- [x] **S-60** Welcome flow — 7 onboarding screens, Apple auth API, TDEE calculator. #backend #frontend #O1 @completed(2026-03-28)
- [x] **S-61** Loading animation — FitsyLoader letter-bounce Reanimated component. #frontend #O1 @completed(2026-03-28)
- [x] **S-55** Macro target setup screen — onboarding flow, persisted to AsyncStorage. #frontend #O1 @completed(2026-03-25)
- [x] **S-56** Profile screen — display saved macros, allow editing, show account email. #frontend #O1 @completed(2026-03-25)
- [x] **S-54** GPS integration — replace hardcoded Silver Lake coords with expo-location. #frontend #O1 @completed(2026-03-25)
- [x] **S-57** JWT middleware on restaurant routes. #backend #O1 @completed(2026-03-25)
- [x] **S-53** Fix mobile crash — Expo Router v6 + React 19 compat. #cto #O1 @completed(2026-03-25)

## Additional work shipped (not ticketed)
- V2 search UI — category filters + horizontal card rows (replaced hero card layout)
- Dev login fix — login-first flow, falls back to register
- Removed dead FFNSource (site redesigned to JS rendering)
- Eval matching improvements

%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
