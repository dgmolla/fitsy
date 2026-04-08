---
kanban-plugin: basic
---

## Backlog

- [ ] **S-100** Fix CI harness — `macroEstimationService` test expects throw on item count mismatch but implementation now pads/truncates; align test contract with implementation. Audit all other red CI checks and fix root causes. #cto #O1
- [ ] **S-94** Apple Sign-In + JWT middleware — wire `expo-apple-authentication`, exchange identity token at `/api/auth/apple`, return JWT; add JWT verification middleware to restaurant routes. #backend #cto #O1
- [ ] **S-96** GPS location permission — replace hardcoded Silver Lake coords with `expo-location`; request permission on search screen; pass lat/lng to API. #frontend #O1
- [ ] **S-97** Wire GPS to API — update `/api/restaurants` to accept `lat`/`lng` params; pass through to Google Places Nearby Search. #backend #O1
- [ ] **S-91** Design idempotent preload strategy — preload must be re-runnable without wiping the DB or breaking user references. Spec required before implementation. #backend #cto #O1
- [ ] **S-93** Auth E2E testing — end-to-end tests covering all authentication flows (Apple Sign-In, Google Sign-In). #mobile #qa #O1

## In Progress


## Done


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
