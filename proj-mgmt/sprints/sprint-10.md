---
kanban-plugin: basic
---

## Backlog

- [ ] **S-91** Design idempotent preload strategy — preload must be re-runnable without wiping the DB or breaking user references (saved meals, future reviews). Upsert restaurants/menus by externalPlaceId + item name, version MacroEstimates (keep latest, archive old), flag stale restaurants not seen in latest run. Support incremental runs (new restaurants only) and full refreshes (update all). Spec required before implementation. #backend #cto #O1
- [ ] **S-92a** Onboarding visual refresh — update `WelcomeScreen` wrapper + `ContinueButton` + `SelectionCard` + `ProgressDots` to editorial palette. Cream bg (#FDFBF7), Newsreader headings, forest green text, warm borders. Replace dot progress with thin progress bar. Apply to all existing screens (age, height, weight, activity, goal, payment, signin). No new screens, no reordering. #frontend #O2
- [ ] **S-92b** Onboarding Act 1: Hook — 3 new screens. (1) Splash — `fitsy` logo, "Find food that fits." Cream bg, auto-advance 2s. (2) Problem — "You don't want to cook. But you also don't want to blow your macros." Full-bleed food photo with dark gradient + text overlay. (3) Promise — "We find restaurants near you with meals that hit your targets." Show mocked search result card with P/C/F. #frontend #O2 ^dep-S-92a
- [ ] **S-92c** Onboarding Act 2: Reorder + enrich — move goal screen first (most motivating). Add "Your Targets" reveal screen after weight — shows calculated P/C/F in macro strip design (same as search screen). Aha moment. Upgrade scroll pickers to card-based selection where possible. #frontend #O2 ^dep-S-92a
- [ ] **S-92d** Onboarding Act 3: Convert — 4 new/updated screens. (10) Preview — show 2-3 real restaurant cards from DB with user's targets applied. (11) How it works — "Published nutrition for chains. AI-estimated macros for local spots." Two panels: chain verified badge + indie AI confidence scores. (12) Free trial — "Try Fitsy free for 7 days." Features list + CTA. (13) Paywall — $5/mo or $30/year pricing cards, monthly vs annual toggle. Show discount if user taps X on paywall. #frontend #O2 ^dep-S-92a ^dep-S-92c
- [ ] **S-92e** Onboarding finale — (14) Sign in: Apple/Google, editorial palette. (15) Welcome: "You're in. Let's eat." Celebration animation, auto-nav to search after 2s. #frontend #O2 ^dep-S-92d
- [ ] **S-93** Auth E2E testing — end-to-end tests covering all authentication flows (Apple Sign-In, Google Sign-In). #mobile #qa #O1

## In Progress


## Done


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
