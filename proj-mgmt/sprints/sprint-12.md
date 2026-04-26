---
kanban-plugin: basic
---

<!-- last-updated: 2026-04-25 -->
<!-- spec: docs/product/launch-plan.md -->

> **Goal:** Ship to TestFlight, run a compressed 1-week / 2-round beta, and clear all launch-gating items so we can submit to the App Store.
>
> **Spec:** `docs/product/launch-plan.md` (Phase 1 checklist) + cross-session punch list (2026-04-25). Apple Developer account approved 2026-04-25 — TestFlight path now unblocked.
>
> **Compressed schedule:** Day 0 code fixes + first build → Day 1–3 Round 1 (5–8 testers) → Day 3 rebuild → Day 4–7 Round 2 (5–8 fresh testers) → Day 7–8 go/no-go + App Store submit.
>
> **Sequencing note:** First EAS build is a dev/smoke build to validate native modules (Apple SSO, Google SSO, PostHog) on a real device — gated only on **S-204** (real Google client IDs in EAS dashboard). Wave 1 code fixes land in parallel; Wave 2's production build for TestFlight requires Wave 1 done.

## Backlog

### Wave 1 — Code blockers (must land before TestFlight production build)

- [x] **S-200** SecureStore migration — replaced AsyncStorage with `expo-secure-store` in `apps/mobile/lib/authClient.ts` (1 import + 3 calls: `getItemAsync`/`setItemAsync`/`deleteItemAsync`). Installed `expo-secure-store` via `npx expo install`. Function signatures unchanged so callers don't change. tsc clean. AsyncStorage package retained in `package.json` for any non-token usage elsewhere. #frontend #security #wave-1 @completed(2026-04-26)
- [x] **S-201** Account deletion endpoint + UI — added `DELETE /api/user/route.ts` with `requireAuth` guard + Prisma `$transaction` cascading SavedItem → MacroTarget → Subscription → User, then `getSupabaseAdmin().auth.admin.deleteUser()` (non-fatal if it fails — DB is source of truth). Returns 204 on success, 500 on transaction failure. 4 passing tests in `route.test.ts` (auth guard, success, Supabase-fail-still-204 invariant, transaction-throws-500). Frontend: subtle "Delete account" button in `apps/mobile/app/(tabs)/profile.tsx` with native confirmation alert; on confirm calls `api.del('/api/user')`, clears token, navigates to `/welcome/problem` (matches logout flow). Both tsc clean. #backend #frontend #wave-1 @completed(2026-04-26)
- [x] **S-202** Health disclaimer copy — `apps/mobile/app/welcome/how-it-works.tsx:46` now reads "AI-analyzed menus. Approximate — not medical advice." Single edit, no duplicates elsewhere. #frontend #legal #wave-1 @completed(2026-04-26)
- [x] **S-203** GPS via expo-location — verified already implemented; no change needed. `apps/mobile/lib/useLocation.ts` exposes a `useLocation()` hook (returns `{lat, lng, source: 'gps'|'fallback', loading}`) with permission flow + fast `getLastKnownPositionAsync` + 3s timeout race. `apps/mobile/app/(tabs)/search.tsx` already imports it (L22), reads coords (L450), and switches label between "Locating..." / "Near You" / "Silver Lake, LA" by source (L467+). The only remaining `34.0xxx` literals are inside `MOCK_RESULTS` offline fixtures, not API inputs. Side note: CLAUDE.md "Current State" is stale on this — says "no GPS yet" but it's been wired. #frontend #backend #wave-1 @completed(2026-04-26)

### Wave 2 — Build & infra gates

- [x] **S-204** EAS dashboard: real Google client IDs — pushed `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` + `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` server-side via `eas env:create` for both `production` and `preview` environments (plaintext visibility — public OAuth client IDs). Removed inline placeholder `env` blocks from `apps/mobile/eas.json` so server-side values take effect at build time. Verified with `eas env:list`. #devops #wave-2 @completed(2026-04-25)
- [x] **S-205** RLS — DECIDED TO SKIP. API uses Postgres `service_role` which bypasses RLS; the only attack path RLS would close is direct anon-key Supabase access, which is *already* blocked by default-deny (RLS on, zero policies = nothing readable by anon). Applying the drafted policies (`prisma/migrations/20260425000001_rls_policies/migration.sql`) would actually *open* the anon backdoor on Restaurant/MenuItem/MacroEstimate, which is a regression. Migration parked as a future-reference artifact for the day we ever route traffic through anon/authenticated roles (realtime, edge SSR, per-user JWTs). #backend #security #wave-2 @completed(2026-04-25)
- [x] **S-205b** Apple Developer Portal: register App ID — registered `app.fitsy.mobile` with Sign In with Apple capability. (Original choice `com.fitsy.app` was globally taken — switched 2026-04-25; bundle ID swept across 6 files in repo.) #devops #wave-2 @completed(2026-04-25)
- [x] **S-205c** App Store Connect: create app record — created with bundle ID `app.fitsy.mobile`, name "Fitsy", SKU `fitsy-ios-001`. #devops #wave-2 @completed(2026-04-25)
- [x] **S-205d** Google Cloud Console: update iOS OAuth client bundle ID — switched from `com.fitsy.app` to `app.fitsy.mobile`. Existing client IDs unchanged. #devops #wave-2 @completed(2026-04-25)
- [x] **S-205e** Supabase Apple provider config — Client IDs set to `app.fitsy.mobile`, Secret Key cleared (native flow only — no Service ID/.p8/JWT needed for `expo-apple-authentication`). #backend #wave-2 @completed(2026-04-25)
- [x] **S-205f** DB password rotation — rotated Supabase Postgres password (the old one was accidentally pasted into the Supabase Apple OAuth Secret Key field as a credential — discovered via screenshot inspection). Local `.env.local` files updated via `/tmp/rotate-db-pw.sh`. **NOTE**: rotation script targeted the wrong Vercel project (`fitsy` landing site instead of `fitsy-api`); fix tracked as S-205g. #backend #security #wave-2 @completed(2026-04-25)
- [x] **S-205g** Fix DB password in `fitsy-api` Vercel project — repo's `.vercel/project.json` is linked to `fitsy` (landing site), but the actual API runs on the separate `fitsy-api` project (`fitsy-api.vercel.app` / `fitsy.org`). Production API was 503-ing because it had the OLD DB password. Pushed updated `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PASSWORD` across Production + Development on `fitsy-api` via `/tmp/fix-fitsy-api-pw.sh`. Initial in-script `vercel --prod` redeploy failed (ran from empty `/tmp/fitsy-api-vercel/`); fixed via `vercel redeploy <last-good-prod-url>` which re-aliased to `fitsy.org`. Verified `curl https://fitsy-api.vercel.app/api/health` returns 200 / `db: connected`. #devops #security #wave-2 ^dep-S-205f @completed(2026-04-26)
- [ ] **S-206** EAS dev build — smoke test natives (IN PROGRESS) — `eas build --profile development --platform ios` running. Validate on real hardware once installable: (a) Apple Sign-In end-to-end, (b) Google Sign-In end-to-end, (c) PostHog events fire (verify in PostHog dashboard), (d) deep link `fitsy://` opens app. Document any native-module gaps. #devops #cto #wave-2 ^dep-S-204 ^dep-S-205b
- [ ] **S-207** EAS production build → TestFlight — `eas build --profile production --platform ios && eas submit --platform ios`. Upload to App Store Connect, enable internal TestFlight group, invite 5–8 testers. Target ~24h Apple internal review window. #devops #cto #wave-2 ^dep-S-200 ^dep-S-201 ^dep-S-202 ^dep-S-203 ^dep-S-205c ^dep-S-206

### Wave 3 — Round 1 beta (Day 1–3)

- [ ] **S-208** Round 1 recruit + onboard — 5–8 testers from Hollywood/Silver Lake gyms per launch plan recruiting script. Onboard in person via TestFlight QR. Capture name + contact for follow-up. Send Google Form link. #cto #wave-3 ^dep-S-207
- [ ] **S-209** Round 1 daily triage + hotfix loop — daily check on PostHog funnels + crash reports + tester messages. Same-day hotfix on P0s via `eas update` (no rebuild needed for JS-only). Exit: 4/5 completed ≥1 search; no P0 crashes. #cto #frontend #wave-3 ^dep-S-208
- [ ] **S-210** Round 1 → Round 2 build cut — bundle Round 1 fixes; if any native code touched, ship new TestFlight build. Otherwise `eas update` is sufficient. #devops #wave-3 ^dep-S-209

### Wave 4 — Round 2 beta (Day 4–7)

- [ ] **S-211** Round 2 recruit + onboard — 5–8 fresh testers (no Round 1 overlap). Same script. #cto #wave-4 ^dep-S-210
- [ ] **S-212** Round 2 feedback + LLM analysis — collect Google Form responses; run Claude analysis per launch-plan.md template. Save to `docs/product/feedback/round-2-insights.md`. Exit: 5/8 used 3+ times unprompted; ≥2 say "would pay $4/mo". #cto #wave-4 ^dep-S-211
- [ ] **S-213** Go/no-go decision + App Store submit prep — review Round 2 exit criteria; if green, kick off App Store submission (Wave 5 cards become hot). If red, Sprint 13 plans Round 3. #cto #wave-4 ^dep-S-212

### Wave 5 — Launch-gating (parallel with beta)

- [ ] **S-214** /privacy + /support pages live on fitsy.app — copy already drafted in `docs/product/app-store-listing.md`. Host on landing page; link from app welcome screen + App Store listing. #frontend #legal #wave-5
- [ ] **S-215** App Store Connect metadata — title, subtitle, description, keywords, screenshots (5 sizes), promotional text. Copy ready in `docs/product/app-store-listing.md` and `app-store-listing-spec.md`. #cto #design #wave-5
- [ ] **S-216** Age rating form (4+) — App Store Connect age rating questionnaire. Targeting 4+ (no objectionable content). 30 min. #cto #wave-5
- [ ] **S-217** RevenueCat paywall wiring — full RevenueCat section from launch-plan.md:66-92. Deprecate Stripe deps, create products in App Store Connect (`fitsy_monthly` $4.99/mo, `fitsy_annual` $29.99/yr, 7-day trial), install `react-native-purchases`, wire into welcome/payment screen, server-side entitlement verification. **Note**: IAP only testable on EAS build, not Expo Go/simulator. Defer toggle until Wave 4 go/no-go is green. #frontend #backend #wave-5

## In Progress

## Done

%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
