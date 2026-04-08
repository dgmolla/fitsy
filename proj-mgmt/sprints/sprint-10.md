---
kanban-plugin: basic
---

## Backlog

- [ ] **S-91** Design idempotent preload strategy — preload must be re-runnable without wiping the DB or breaking user references (saved meals, future reviews). Upsert restaurants/menus by externalPlaceId + item name, version MacroEstimates (keep latest, archive old), flag stale restaurants not seen in latest run. Support incremental runs (new restaurants only) and full refreshes (update all). Spec required before implementation. #backend #cto #O1
- [ ] **S-92** Onboarding redesign — editorial story flow (15 screens). **Act 1 Hook:** (1) Splash — `fitsy` logo, "Find food that fits." (2) Problem — "You don't want to cook. But you also don't want to blow your macros." Full-bleed food photo. (3) Promise — "We find restaurants near you with meals that hit your targets." Show mocked search card. **Act 2 Personalize:** (4) Goal — Cut/Maintain/Bulk cards. (5) Activity — 4 tappable cards. (6) Age — date picker. (7) Height — toggle ft/cm. (8) Weight — toggle lbs/kg. (9) Your Targets — show calculated P/C/F in macro strip design, aha moment. **Act 3 Convert:** (10) Preview — real restaurant cards with user's targets applied. (11) How it works — "Published nutrition for chains. AI-estimated macros for local spots." Two panels showing chain verified data + indie AI confidence scores. (12) Free trial — "Try Fitsy free for 7 days." Features list + CTA. (13) Paywall — $5/mo or $30/year pricing cards, monthly vs annual. Show discount if user taps X. (14) Sign in — Apple/Google. (15) Welcome — "You're in. Let's eat." Auto-nav to search. Visual: cream bg, Newsreader headings, editorial palette, progress bar (not dots). Spec: `docs/engineering/menu-data-sources-analysis.md`. #frontend #O2
- [ ] **S-93** Auth E2E testing — end-to-end tests covering all authentication flows (Apple Sign-In, Google Sign-In). #mobile #qa #O1

## In Progress


## Done


%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
