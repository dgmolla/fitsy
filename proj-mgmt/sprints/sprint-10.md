---
kanban-plugin: basic
---

## Backlog

- [ ] **S-91** Design idempotent preload strategy — preload must be re-runnable without wiping the DB or breaking user references (saved meals, future reviews). Upsert restaurants/menus by externalPlaceId + item name, version MacroEstimates (keep latest, archive old), flag stale restaurants not seen in latest run. Support incremental runs (new restaurants only) and full refreshes (update all). Spec required before implementation. #backend #cto #O1
- [ ] **S-92** Onboarding enrichment — UI updates, more screens, build a longer onboarding story. Hero tag: "find food that fits." / subtext: "you aren't cooking anyway". Show discount offer if user taps X on paywall during onboarding. #mobile #frontend #O2
- [ ] **S-93** Auth E2E testing — end-to-end tests covering all authentication flows (Apple Sign-In, Google Sign-In). #mobile #qa #O1

## In Progress


## Done


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
