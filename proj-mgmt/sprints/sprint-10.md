---
kanban-plugin: basic
---

<!-- last-updated: 2026-04-08 -->

## Backlog

- [ ] **S-93** Auth E2E testing — end-to-end tests covering all authentication flows (Apple Sign-In, Google Sign-In). #mobile #qa #O1
- [ ] **S-104** Add `ios.bundleIdentifier` to `app.config.ts` + configure `expo-google-services` plugin (`GoogleService-Info.plist`). Required for EAS Build + Google OAuth redirect to work on device. #frontend #O1
- [ ] **S-105** Add `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to EAS build profiles (`eas.json` production + preview); set values in EAS dashboard. After S-104 — also verify redirect URI in Google Cloud Console. #frontend #devops #O1

## In Progress

- [ ] **S-103** Security audit — run Trail of Bits `trailofbits/skills` security audit skill. Focus areas: JWT validation on all protected routes, token storage (AsyncStorage vs SecureStore), input sanitization, API rate limiting, secrets exposure. Document findings; fix all P0/P1 before TestFlight. #cto #backend #O1

## Done

- [x] **S-94** Apple Sign-In + JWT middleware — spec written; transaction + issuer/audience fixes applied; authorizationCode made optional; account-linking test added. #backend #cto #O1 @completed(2026-04-08)
- [x] **S-101** Idempotent preload strategy — unique constraints on MenuItem(restaurantId, name) + MacroEstimate(menuItemId); migration with dedup guards; spec + runbook. #backend #cto #O1 @completed(2026-04-08)
- [x] **S-102** PostHog analytics — 5 events instrumented (search, restaurant tap, item save, onboarding, auth); PostHogProvider wired; pure state updaters; typed number macros. #frontend #O1 @completed(2026-04-08)
- [x] **S-99** Validate Google Sign-In flow — confirmed OAuth handshake, token exchange, and session creation work end-to-end in dev. Documented 3 P0 and 3 P1 gaps before TestFlight. See `docs/engineering/auth/google-signin-validation.md`. #cto #O1 @completed(2026-04-08)
- [x] **S-100** Fix CI harness — aligned macroEstimationService and uberEatsSource tests to current implementation contracts (pad/truncate behavior + 2-step UE lookup). #cto #O1 @completed(2026-04-08)


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
