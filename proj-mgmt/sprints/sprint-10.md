---
kanban-plugin: basic
---

<!-- last-updated: 2026-04-08 -->

## Backlog

- [ ] **S-93** Auth E2E testing — end-to-end tests covering all authentication flows (Apple Sign-In, Google Sign-In). #mobile #qa #O1
- [ ] **S-103** Security audit — run Trail of Bits `trailofbits/skills` security audit skill. Focus areas: JWT validation on all protected routes, token storage (AsyncStorage vs SecureStore), input sanitization, API rate limiting, secrets exposure. Document findings; fix all P0/P1 before TestFlight. #cto #backend #O1

## In Progress

- [ ] **S-94** Apple Sign-In + JWT middleware — wire `expo-apple-authentication`, exchange identity token at `/api/auth/apple`, return JWT; add JWT verification middleware to restaurant routes. #backend #cto #O1
- [ ] **S-99** Validate Google Sign-In flow — confirm OAuth handshake, token exchange, and session creation work end-to-end in dev. Document any gaps before TestFlight. #cto #O1
- [ ] **S-101** Design idempotent preload strategy — preload must be re-runnable without wiping the DB or breaking user references. Spec required before implementation. #backend #cto #O1
- [ ] **S-102** PostHog analytics integration — instrument key events (search performed, restaurant tapped, item saved, onboarding completed, auth success/failure) in mobile and API. Capture user properties (macro targets, goals). Required before beta to understand funnel drop-off. #frontend #backend #O1

## Done

- [x] **S-100** Fix CI harness — aligned macroEstimationService and uberEatsSource tests to current implementation contracts (pad/truncate behavior + 2-step UE lookup). #cto #O1 @completed(2026-04-08)


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
