---
kanban-plugin: basic
---

## Backlog

- [ ] **S-91** Design idempotent preload strategy — preload must be re-runnable without wiping the DB or breaking user references (saved meals, future reviews). Upsert restaurants/menus by externalPlaceId + item name, version MacroEstimates (keep latest, archive old), flag stale restaurants not seen in latest run. Support incremental runs (new restaurants only) and full refreshes (update all). Spec required before implementation. #backend #cto #O1

## In Progress


## Done


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
