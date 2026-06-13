---
kanban-plugin: basic
---

<!-- last-updated: 2026-05-09 -->
<!-- wave-2: complete on code (13 PRs merged 2026-05-03..04). Only S-207 TestFlight build remains in wave-2; everything after is wave-3+. -->
<!-- spec: docs/product/archive/launch-plan.md -->

> **Goal:** Ship to TestFlight, run a 1-week / 2-round beta, clear all launch-gating items so we can submit to the App Store.
>
> **Spec:** `docs/product/archive/launch-plan.md` (Phase 1 checklist) + cross-session punch list (2026-04-25). Apple Developer account approved 2026-04-25.
>
> **Schedule:** Day 0 code fixes + first build → Day 1–3 Round 1 (5–8 testers) → Day 3 rebuild → Day 4–7 Round 2 (5–8 fresh testers) → Day 7–8 go/no-go + App Store submit.

## Backlog

- [ ] **S-207 EAS production build → TestFlight** — `eas build --profile production --platform ios && eas submit --platform ios`. Upload to App Store Connect, enable internal TestFlight group, invite 5–8 testers. ~24h Apple internal review window. Comes last — every other Wave-2 ticket must be green first. #devops #cto #wave-2 ^dep-S-200 ^dep-S-201 ^dep-S-202 ^dep-S-203 ^dep-S-205c ^dep-S-206 ^dep-S-221 ^dep-S-222 ^dep-S-225 ^dep-S-226a ^dep-S-226b ^dep-S-227 ^dep-S-228a ^dep-S-228b ^dep-S-229 ^dep-S-230a ^dep-S-230b

- [ ] **S-208 Round 1 recruit + onboard** — 5–8 testers from Hollywood/Silver Lake gyms. Onboard in person via TestFlight QR. Capture name + contact. Send Google Form link. #cto #wave-3 ^dep-S-207

- [ ] **S-209 Round 1 daily triage + hotfix loop** — daily PostHog funnels + crash reports + tester messages. Same-day P0 hotfix via `eas update`. Exit: 4/5 completed ≥1 search; no P0 crashes. #cto #frontend #wave-3 ^dep-S-208

- [ ] **S-210 Round 1 → Round 2 build cut** — bundle Round 1 fixes; native code → new TestFlight build, JS-only → `eas update`. #devops #wave-3 ^dep-S-209

- [ ] **S-211 Round 2 recruit + onboard** — 5–8 fresh testers (no Round 1 overlap). #cto #wave-4 ^dep-S-210

- [ ] **S-212 Round 2 feedback + LLM analysis** — collect Google Form responses; run Claude analysis per launch-plan.md template. Save to `docs/product/feedback/round-2-insights.md`. Exit: 5/8 used 3+ times unprompted; ≥2 say "would pay $4/mo". #cto #wave-4 ^dep-S-211

- [ ] **S-213 Go/no-go + App Store submit prep** — review Round 2 exit criteria; if green, kick off App Store submission (Wave 5). If red, Sprint 13 plans Round 3. #cto #wave-4 ^dep-S-212

- [ ] **S-214 /privacy + /support pages** — copy in `docs/product/app-store-listing.md`. Host on landing; link from app welcome + App Store listing. #frontend #legal #wave-5

- [ ] **S-215 App Store Connect metadata** — title, subtitle, description, keywords, screenshots (5 sizes), promotional text. Copy in `docs/product/app-store-listing.md` and `app-store-listing-spec.md`. #cto #design #wave-5

- [ ] **S-216 Age rating form (4+)** — App Store Connect age rating questionnaire. 30 min. #cto #wave-5

- [ ] **S-219 RLS guardrails — block careless permissive policies** — three layers: (1) **structural test** (`scripts/structural-tests.sh`) queries `pg_policies` and fails CI if any policy on `User`/`MacroTarget`/`SavedItem`/`Subscription` is `PERMISSIVE` for `anon` or has `qual = true` / missing `auth.uid()` clause; (2) **live canary** Vercel cron (model on `audit-macro-drift`) that curls `<project>.supabase.co/rest/v1/<table>` with the anon key against each user table, pages Slack `C0ASM3865AA` on any non-empty response — catches dashboard edits that bypass migrations; (3) **CODEOWNERS / PR template rule** requiring `#backend` review on any file matching `prisma/migrations/**/*rls*` or containing `CREATE POLICY` (no auto-merge). Context: RLS is enabled on all 9 public tables but 0 policies exist; default-deny is the only thing keeping anon-key direct-Supabase reads from leaking user data (per `docs/engineering/backend/perf-and-security-handoff-2026-04-25.md`). #backend #security #wave-5

- [ ] **S-220 API perf follow-ups — finish denormalization migration** — apply the search-perf win pattern (drop stale `MacroEstimate` joins; read denormalized macros from `MenuItem`) to the 4 endpoints it was never applied to: menu detail, saved-items, SEO `[slug]` page, **and `/api/restaurants/stats`** (the `menuItem.count({ where: { macroEstimates: { some: {} } } })` should become `count({ where: { calories: { not: null } } })` — onboarding screen hits this on cold start). Plus 7 smaller wins (LIMIT on menu items, `Promise.all` in `PATCH /user/profile`, atomic OAuth upsert, cache headers on `/preview`, `next/image` on SEO pages). Spec: `docs/engineering/backend/api-perf-followups-spec.md`. **Validation gate**: ship `scripts/profile-api-perf.mjs` (in-process handler calls + `prisma.$on('query')` count + cold/warm ms; exits non-zero if query count exceeds per-endpoint ceiling) — committed this time, unlike the throwaway profile scripts from the 2026-04-25 perf push. Two PRs per spec sequencing. #backend #wave-5

- [ ] **S-223 Agent guardrail — block coding-agent writes/deletes on prod DB** — three layers: (1) **read-only Postgres role** (`fitsy_agent_ro`) created via migration — used as the default `DATABASE_URL` for all agent/scripting sessions; prod writes require explicitly opting in to the `service_role` key, which is never in `.env.local`; (2) **structural test** (`scripts/structural-tests.sh`) greps for any script that imports `PrismaClient` or runs `prisma migrate deploy` / `prisma db push` and verifies it reads `DATABASE_URL` not `POSTGRES_URL_NON_POOLING` — the non-pooling (direct) URL is the only one with DDL rights; (3) **pre-push hook guard** (`.githooks/pre-push`) that blocks pushes if any staged file contains `prisma migrate deploy` combined with a hardcoded production hostname or `process.env.NODE_ENV === 'production'` check bypassed. Goal: a coding agent that accidentally runs a seed/preload script against prod can read but cannot mutate or drop data. Context: agents already have `ANTHROPIC_API_KEY` + Supabase service-role in `.env.local`; the blast radius of an errant `prisma.$executeRaw` or script typo is a full table wipe with no undo. #backend #security #devops #wave-5

- [ ] **S-217 RevenueCat paywall wiring (hard-wall model)** — full launch-plan.md:66-92 section + product decision: trial is the only path into the app. Deprecate Stripe, create products in App Store Connect (`fitsy_monthly` $4.99/mo, `fitsy_annual` $29.99/yr, 7-day trial), install `react-native-purchases`, wire welcome/payment screen, server-side entitlement verification. **Hard-wall requirements**: (a) `welcome/payment.tsx` is terminal for non-subscribers — no "Skip" / "Continue without signing up" / "Try later" affordance; (b) decline path returns to the same screen with a clarifying value-prop sub-screen, never to the app proper; (c) returning users who tap "Already have account?" still go through entitlement check — expired sub = bounced to trial screen, no app access; (d) every protected route checks RevenueCat entitlement, not just login state. IAP only testable on EAS build. Defer impl until Wave 4 go/no-go is green; the hard-wall product decision is locked now. #frontend #backend #wave-5


## In Progress

## Done

- [x] **S-231 Apple sign-in: fire trackAuthSuccess + captureIdentity** — `apps/mobile/app/auth/login.tsx` Apple branch now mirrors Google (capture result, `trackAuthSuccess`, `captureIdentity`, gate `pullProfileFromServer` on `!isNewUser`). #frontend #wave-5 @completed(2026-05-04)

- [x] **S-232 Profile.tsx silent catch cleanup** — `apps/mobile/app/(tabs)/profile.tsx` load() empty `catch { }` replaced with `console.warn` per S-221's no-silent-failures rule. #frontend #wave-5 @completed(2026-05-04)

- [x] **S-225 Onboarding screen — location permission prompt** — `welcome/location-permission.tsx` between signin success and `/(tabs)/search`; primary CTA fires `Location.requestForegroundPermissionsAsync()`, secondary "Maybe later" falls through to Silver Lake fallback. PostHog priming + grant/deny events. Shipped via PR #164. #frontend #wave-2 ^dep-S-224 @completed(2026-05-03)

- [x] **S-222 Comprehensive PostHog instrumentation — measure every meaningful action** — pass over every screen in `app/welcome/*`, `app/(tabs)/*`, `app/restaurant/[id].tsx`; standardized snake_case event/property naming; instrumented failure paths alongside successes; taxonomy doc at `docs/engineering/architecture/analytics-events.md`. Shipped via PR #175. #frontend #analytics #wave-2 @completed(2026-05-03)

- [x] **S-221 Onboarding API reliability sweep — surface and mitigate silent failures** — replaced silent `catch(() => {})` swallows in `lib/useStats.ts`, `app/welcome/finding.tsx`, `app/(tabs)/search.tsx` with PostHog event capture + console.warn; added explicit retry UI for preview prefetch and macro-targets save failures. Shipped via PR #163. #frontend #wave-2 @completed(2026-05-03)

- [x] **S-227 Manual location override (preset neighborhood list)** — `LocationBar` pill is now tappable; bottom sheet lists ~10 LA neighborhoods from `apps/mobile/lib/locations.ts`, persists pick via `expo-secure-store` under `fitsy_manual_location`. PostHog open/pick/clear events. Shipped via PR #167. #frontend #wave-2 ^dep-S-224 @completed(2026-05-03)

- [x] **S-226b Onboarding screen — notification permission prompt** — `welcome/notification-permission.tsx` after location-permission, before `/(tabs)/search`; `useNotifications` hook, `expo-notifications` plugin in `app.config.ts`, push token POSTed to `/api/user/push-token` (S-226a) on grant. PostHog priming + grant/deny events. Shipped via PR #166. #frontend #wave-2 ^dep-S-225 ^dep-S-226a @completed(2026-05-03)

- [x] **S-226a Push token capture endpoint + migration** — Prisma migration adding `pushToken String?` to `User`; `POST /api/user/push-token` route (auth-required, idempotent re-register). Tests cover happy path, 401, repeat POSTs. Shipped via PR #165. #backend #wave-2 @completed(2026-05-03)

- [x] **S-229 Restaurant detail redesign — "Filter First" (mockup № 08)** — ported `apps/mobile/app/restaurant/[id].tsx` to utility-forward layout: compact top nav, editorial header, menu search pill, horizontal filter chip row, dark sort bar, redesigned item cards with circular match-% badge. Drops photo hero + View Mode toggle. Reuses `EDITORIAL` / `MACRO_COLORS` tokens. Telemetry via S-222 conventions. Shipped via PR #170. #frontend #design #wave-2 @completed(2026-05-03)

- [x] **S-230b Search FlatList + infinite scroll** — replaced `ScrollView` + `.map()` in `apps/mobile/app/(tabs)/search.tsx` with `FlatList`; `Masthead`, `MacroStrip`, `CuisineRow`, hero card moved into `ListHeaderComponent`; `onEndReached` paginates via `nextCursor` with footer spinner; resets cursor on filter/cuisine/macro/location change. PostHog `search_page_loaded` + `search_pagination_end_reached`. Shipped via PR #174. #frontend #wave-2 ^dep-S-230a @completed(2026-05-03)

- [x] **S-230a Cursor pagination on /api/restaurants** — `GET /api/restaurants` accepts opaque base64 `cursor` of `{ id, distanceMiles }`; response shape now `{ data, meta: { total, limit, nextCursor } }`. `findNearbyRestaurants` adds tie-broken `(distance, id) > (cursorDistance, cursorId)` clause for stable paging across equal distances. Shared types + tests updated. Shipped via PR #171. #backend #wave-2 @completed(2026-05-03)

- [x] **S-228b Mobile auto-refresh via Supabase SDK** — wired `@supabase/supabase-js` on mobile with `expo-secure-store` adapter; `apps/mobile/lib/supabase.ts` configured for `persistSession + autoRefreshToken`; auth flows now hand off to `setSession`; `api.ts` Bearer header pulls from `getSession()`; `_layout.tsx` calls `startAutoRefresh`/`stopAutoRefresh` on AppState transitions. PostHog `session_refreshed` / `session_refresh_failed` from `onAuthStateChange`. Eliminates the cold-start bounce after 1h+ token expiry. Manual real-device validation still required against EAS dev build. Shipped via PR #173. #frontend #wave-2 ^dep-S-228a @completed(2026-05-03)

- [x] **S-228a Auth routes return full Supabase session** — `apps/api/app/api/auth/{login,register,apple,google}/route.ts` now return `{ token, refreshToken, user }`; shared `AuthApiResponse` / `AppleAuthResponse` / `GoogleAuthResponse` types updated; route tests assert the new shape. Shipped via PR #168. #backend #wave-2 ^dep-S-200 @completed(2026-05-03)

- [x] **S-224 Validate location services on real device** — S-203 shipped the `useLocation` hook but GPS has only been verified in simulator. On a real device: (1) confirm permission prompt appears and respects denied state gracefully; (2) confirm coordinates resolve to a non-Silver-Lake location; (3) confirm 3s timeout fallback fires and surfaces a user-visible message (not silent). Log a PostHog `location_permission_denied` event on deny. Exit: live search result set differs from the hardcoded-coords result set, confirming real GPS is driving queries. #frontend #cto #wave-2 ^dep-S-206 @completed(2026-05-03)

- [x] **S-206 EAS dev build smoke test** — validate on real hardware: Apple Sign-In, Google Sign-In, PostHog events, deep link `fitsy://`. Document any native-module gaps. #devops #cto #wave-2 ^dep-S-204 ^dep-S-205b @completed(2026-05-03)

- [x] **S-218 Apple + Google sign-in failure** — Google ✅ closed: works end-to-end after SecureStore-key fix (`fitsy:authToken` → `fitsy_authToken`) shipped in `3683309`. Apple resolved on device after capability propagation + provider config settled. #frontend #devops #wave-2 ^dep-S-205b ^dep-S-205d @completed(2026-05-03)

- [x] **S-200 SecureStore migration** — replaced AsyncStorage with `expo-secure-store` in `apps/mobile/lib/authClient.ts`. Function signatures unchanged. tsc clean. #frontend #security #wave-1 @completed(2026-04-26)

- [x] **S-201 Account deletion endpoint + UI** — `DELETE /api/user/route.ts` with `requireAuth` + Prisma `$transaction` (SavedItem → MacroTarget → Subscription → User) + best-effort Supabase admin delete. 4 passing tests. Profile screen "Delete account" button with destructive `Alert.alert`; clears token, routes to `/welcome/problem`. #backend #frontend #wave-1 @completed(2026-04-26)

- [x] **S-202 Health disclaimer copy** — `apps/mobile/app/welcome/how-it-works.tsx:46` → "AI-analyzed menus. Approximate — not medical advice." #frontend #legal #wave-1 @completed(2026-04-26)

- [x] **S-203 GPS via expo-location** — already implemented; verified. `apps/mobile/lib/useLocation.ts` hook (lat/lng/source/loading) wired into `search.tsx` with permission flow + 3s timeout race. CLAUDE.md "Current State" stale on this — flag for follow-up. #frontend #backend #wave-1 @completed(2026-04-26)

- [x] **S-204 EAS Google client IDs** — pushed `EXPO_PUBLIC_GOOGLE_*` to EAS server-side env (production + preview), removed inline placeholders from `eas.json`. Later: added `EXPO_PUBLIC_API_URL` across all 3 envs via `scripts/sync-eas-env.py`. #devops #wave-2 @completed(2026-04-25)

- [x] **S-205 RLS — SKIPPED** — API uses Postgres `service_role` (bypasses RLS); default-deny RLS already blocks anon-key backdoor. Applying drafted policies would *open* anon read on Restaurant/MenuItem/MacroEstimate — regression. Migration parked at `docs/engineering/backend/rls-policies-parked.sql`. #backend #security #wave-2 @completed(2026-04-25)

- [x] **S-205b Apple App ID registered** — `app.fitsy.mobile` with Sign In with Apple capability. (Original `com.fitsy.app` globally taken; bundle ID swept across 6 files in repo.) #devops #wave-2 @completed(2026-04-25)

- [x] **S-205c App Store Connect app record** — bundle ID `app.fitsy.mobile`, name "Fitsy", SKU `fitsy-ios-001`. #devops #wave-2 @completed(2026-04-25)

- [x] **S-205d Google Cloud iOS OAuth bundle ID** — switched from `com.fitsy.app` to `app.fitsy.mobile`. Existing client IDs unchanged. #devops #wave-2 @completed(2026-04-25)

- [x] **S-205e Supabase Apple provider config** — Client IDs set to `app.fitsy.mobile`, Secret Key cleared (native flow only — no Service ID/.p8/JWT needed for `expo-apple-authentication`). #backend #wave-2 @completed(2026-04-25)

- [x] **S-205f DB password rotation** — rotated Supabase Postgres password (old one was leaked into Supabase Apple OAuth Secret Key field; discovered via screenshot). Local `.env.local` files updated. Rotation script targeted wrong Vercel project (`fitsy` landing instead of `fitsy-api`); fix in S-205g. #backend #security #wave-2 @completed(2026-04-25)

- [x] **S-205g Fix DB password in fitsy-api** — repo's `.vercel/project.json` was linked to `fitsy` (landing) but real API runs on separate `fitsy-api` project. Prod was 503-ing with old password. Updated `POSTGRES_*` on `fitsy-api`, redeployed via `vercel redeploy <last-good-prod-url>`. Verified `curl https://fitsy-api.vercel.app/api/health` → 200 / `db: connected`. #devops #security #wave-2 ^dep-S-205f @completed(2026-04-26)

%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
