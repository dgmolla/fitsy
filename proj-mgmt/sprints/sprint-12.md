---
kanban-plugin: basic
---

<!-- last-updated: 2026-04-26 -->
<!-- spec: docs/product/launch-plan.md -->

> **Goal:** Ship to TestFlight, run a 1-week / 2-round beta, clear all launch-gating items so we can submit to the App Store.
>
> **Spec:** `docs/product/launch-plan.md` (Phase 1 checklist) + cross-session punch list (2026-04-25). Apple Developer account approved 2026-04-25.
>
> **Schedule:** Day 0 code fixes + first build → Day 1–3 Round 1 (5–8 testers) → Day 3 rebuild → Day 4–7 Round 2 (5–8 fresh testers) → Day 7–8 go/no-go + App Store submit.

## Backlog

- [ ] **S-207 EAS production build → TestFlight** — `eas build --profile production --platform ios && eas submit --platform ios`. Upload to App Store Connect, enable internal TestFlight group, invite 5–8 testers. ~24h Apple internal review window. #devops #cto #wave-2 ^dep-S-200 ^dep-S-201 ^dep-S-202 ^dep-S-203 ^dep-S-205c ^dep-S-206

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

- [ ] **S-217 RevenueCat paywall wiring (hard-wall model)** — full launch-plan.md:66-92 section + product decision: trial is the only path into the app. Deprecate Stripe, create products in App Store Connect (`fitsy_monthly` $4.99/mo, `fitsy_annual` $29.99/yr, 7-day trial), install `react-native-purchases`, wire welcome/payment screen, server-side entitlement verification. **Hard-wall requirements**: (a) `welcome/payment.tsx` is terminal for non-subscribers — no "Skip" / "Continue without signing up" / "Try later" affordance; (b) decline path returns to the same screen with a clarifying value-prop sub-screen, never to the app proper; (c) returning users who tap "Already have account?" still go through entitlement check — expired sub = bounced to trial screen, no app access; (d) every protected route checks RevenueCat entitlement, not just login state. IAP only testable on EAS build. Defer impl until Wave 4 go/no-go is green; the hard-wall product decision is locked now. #frontend #backend #wave-5

## In Progress

- [ ] **S-206 EAS dev build smoke test** — validate on real hardware: Apple Sign-In, Google Sign-In, PostHog events, deep link `fitsy://`. Document any native-module gaps. #devops #cto #wave-2 ^dep-S-204 ^dep-S-205b

## Done

- [x] **S-218 Diagnose Apple + Google sign-in failure on dev build** — built fresh `development-simulator` profile build (`53c430c9`), installed in iPhone 15 sim via mobile MCP, drove both flows. **Findings**: (1) Google reaches Google's OAuth page with "Sign in to continue to fitsy" — proves `EXPO_PUBLIC_GOOGLE_*` env vars resolve, GCP client ID + redirect URI match, expo-auth-session integration is healthy. (2) Apple reaches "Sign in with your Apple ID in Settings" prompt — proves Sign In with Apple capability + provisioning entitlement are present (not the "unavailable" error). Both flows are configured correctly when the artifact has the right env baked in. **Root cause**: Dawit is running the 06:46 UTC `ae941d1` preview build, made before today's bundle-ID swap and before `EXPO_PUBLIC_*` were synced to EAS preview env. That build has localhost:3000 baked in for `EXPO_PUBLIC_API_URL` and missing/old Google client IDs. **Fix**: install the 19:05 UTC `4f586e6` preview build from https://expo.dev/accounts/dgmolla/projects/fitsy/builds — it has all 3 env vars synced and bundle ID `app.fitsy.mobile`. Open follow-up: verify Supabase Google provider config (web client ID) once Dawit completes the OAuth flow on the new build — backend may still reject the ID token if Supabase-side Google config is incomplete. #frontend #devops #wave-2 ^dep-S-205b ^dep-S-205d @completed(2026-04-26)

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
