---
kanban-plugin: basic
---

## Backlog

- [ ] **S-74** Add FatSecret source — implement `fatSecretSource.ts` in `apps/api/services/menuSources/`. Raw fetch to `foods.fatsecret.com/calories-nutrition/{slug}`, parse `<b>` + `Per 1 serving - Calories: Xkcal | Fat: Xg | Carbs: Xg | Protein: Xg` pattern. Returns `macros` map. ~1,060 chains covered. Unit tests with cached HTML fixture. Add to resolver as Phase 1b (after FFN, before UE). Spec: `docs/engineering/menu-data-sources-analysis.md`. #backend #O1
- [ ] **S-75** Two-path estimation — update resolver/preload to use two estimation strategies: (1) if FFN/FatSecret found macros → use official data, done; (2) everything else → UE JSON-LD description + Haiku estimation. This ensures descriptions only fire for indie restaurants where Haiku has no memorized data. Spec: `docs/engineering/menu-data-sources-analysis.md`. #backend #O1 ^dep-S-74
- [ ] **S-76** Re-run hero eval with two-path pipeline — validate that chains get official macros (0% error) and indie items get description-informed estimates. Compare against previous hero eval baselines. Spec: `docs/engineering/menu-data-sources-analysis.md`. #backend #O1 ^dep-S-75
## In Progress


## Done

- [x] **S-72** Hero eval — primary benchmark for new pipeline. Fetch UE store pages for ~8 chains via raw HTTP, extract JSON-LD menus. Fetch FFN ground truth macros. Run items through the new estimation flow (UE structured context → Haiku). Compare against FFN ground truth AND against name-only baseline. Target: MdAPE ≤ 8% (down from 10-13%), red flags ≤ 12/60. Spec + exit criteria: `docs/engineering/menu-data-sources-analysis.md`. #backend #O1 ^dep-S-71 @completed(2026-04-05)
- [x] **S-71** Refactor preload.ts — thin orchestrator using service imports. Schema migration for `MacroEstimate.source`, `MenuItem.section`, `Restaurant.menuSourceId`. #backend #O1 @completed(2026-04-05)
- [x] **S-73** FFN parser validation — Scrape 10 chains from FFN/FatSecret, parse HTML tables, compare against hand-curated `ground-truth.json` fixtures. Pass criteria: 0% calorie error. Every mismatch is a parser bug. Spec: `docs/engineering/menu-data-sources-analysis.md`. #backend #O1 @completed(2026-04-05)
- [x] **S-70** Build macro estimation service — `macroEstimationService.ts`, `(MacroData | null)[]` positional contract, 17 unit tests. #backend #O1 @completed(2026-04-05)
- [x] **S-69** Build MenuSource modules — `types.ts`, `ffnSource.ts`, `uberEatsSource.ts`, `resolver.ts`. 50 unit tests with cached HTML fixtures. #backend #O1 @completed(2026-04-05)
- [x] **S-62** Fix saved meals — saving meals silently fails; debug BookmarkButton → POST /api/saved-items flow, fix root cause, e2e test via mobile MCP + simulator before PR, post PR to Slack #frontend #backend #O1 @completed(2026-03-29)
- [x] **S-63** Fix auth — restrict sign-in to Apple and Gmail only; remove or disable all other auth providers, e2e test full sign-in flow via mobile MCP + simulator before PR, post PR to Slack #frontend #backend #O1 @completed(2026-03-29)

- [x] **S-59** Saved meals — Saved tab, BookmarkButton, GET/POST/DELETE /api/saved-items, restaurant detail integration #backend #frontend #O1 @completed(2026-03-28)
- [x] **S-60** Welcome flow — 7 onboarding screens, Apple auth API, profile PATCH, TDEE calculator, subscription verify stub #backend #frontend #O1 @completed(2026-03-28)
- [x] **S-61** Loading animation — FitsyLoader letter-bounce Reanimated component, wired into restaurant detail + saved tab #frontend #O1 @completed(2026-03-28)
- [x] **S-55** Macro target setup screen — onboarding flow to capture protein/carbs/fat targets, persisted to AsyncStorage #frontend #O1 #wave-1 @completed(2026-03-25)
- [x] **S-56** Profile screen — display saved macros, allow editing, show account email #frontend #O1 #wave-1 @completed(2026-03-25)
- [x] **S-54** GPS integration — replace hardcoded Silver Lake coords with `expo-location` device GPS #frontend #O1 #wave-1 @completed(2026-03-25)
- [x] **S-57** JWT middleware on restaurant routes — protect `GET /api/restaurants` and `GET /api/restaurants/[id]/menu` #backend #O1 #wave-1 @completed(2026-03-25)
- [x] **S-53** Fix mobile crash — reproduce and resolve "exception in host function" on physical device (Expo Router v6 + React 19 compat) #cto #O1 #wave-1 @completed(2026-03-25)

## Sprint Review

### CTO: Harness evaluation
- [ ] Run `bash scripts/harness-metrics.sh` and record results
- [ ] Identify weakest metric and root cause
- [ ] Create harness fix tasks for next sprint
- [ ] Update CLAUDE.md if architecture/conventions changed
- [ ] Run entropy checks (dead exports, unused deps, stale docs)

### Product Manager: Sprint bookkeeping
- [ ] Update OKR progress in `proj-mgmt/okrs.md`
- [ ] Archive this sprint in `proj-mgmt/sprint.md`
- [ ] Create next sprint board
- [ ] Populate next sprint backlog from OKRs + harness fixes + deferred work

### Human: Review and decide (hard gate — sprint does not advance without this)
- [ ] Review Sprint Summary (generated by sprint coordinator)
- [ ] Course corrections — anything to change?
- [ ] Approve or reprioritize the proposed next sprint backlog
- [ ] Review harness metrics — agree with fix plan?
- [ ] Sign off to proceed

%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
