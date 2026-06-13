# Docs Audit & Refactor Proposal — 2026-06-11

> **✅ EXECUTED 2026-06-12** on branch `docs/refactor-2026-06`. Tree restructured (`architecture/`, `pipeline/`, per-domain `archive/`), GTM consolidated 4→3, business-model rewritten for RevenueCat, 3 new feature specs + vision/roadmap/strategy/tuning-guide created, CLAUDE.md + refs updated, 41 archive docs bannered. This file is kept as the audit record. Current index: [`docs/README.md`](README.md).


**Scope:** all 95 markdown files in `docs/`, `proj-mgmt/`, `.claude/`, `.github/`, plus `CLAUDE.md`.
**Method:** five parallel domain audits (backend, frontend, devops/pipeline, product/gtm/design, proj-mgmt/meta), each cross-checked against the codebase and git history. Conflicting verdicts were re-verified directly (e.g., GPS shipped — `apps/mobile/lib/useLocation.ts` exists).

---

## Part 1 — Audit Findings

### Headline numbers

- ~40 files **current**, ~15 **stale** (contain claims contradicted by shipped code), ~10 **superseded** by newer docs, ~30 **historical** (completed one-off ticket specs / spikes that should move to an archive).
- **3 files referenced by agent definitions don't exist** (`docs/product/vision.md`, `docs/gtm/strategy.md`, `docs/tuning-guide.md`).
- **1 critical file is not in git**: `docs/product/pre-launch-action-items.md` — the single most current launch tracker.

### Finding 1 — Pipeline docs: 10 docs, 4 directories, 2 sources of truth

The data pipeline is documented in `backend/` (preload-runbook, idempotent-preload-spec, scraping-spike), `devops/` (preload-pipeline-spec), `specs/` (data-pipeline-v2, data-pipeline-v3), `plans/` (ue-first-pipeline, pipeline-v3-hardening, ue-feed-spike-findings), and `engineering/` root (menu-data-sources-analysis).

- **Living truth:** `specs/data-pipeline-v3.md` (hex checkpointing, Brave Search, Axiom) + `plans/ue-first-pipeline.md` (current UE-first discovery). Both verified accurate against `scripts/preload-ue-first.ts`.
- **Superseded:** `devops/preload-pipeline-spec.md` describes Google Places + Firecrawl discovery — both removed from the code (`googlePlacesService.ts` deleted; S-141 moved discovery to Overture, then UE-first).
- **Stale:** `backend/preload-runbook.md` documents the old `npm run preload` interface; the live pipeline uses `preload-ue-first.ts --phase` flags. Same staleness in `devops/production-deployment.md` Step 2.
- **Missing artifact:** `ue-first-pipeline.md:385` requires a committed `ue-first-baseline-v6.md` (Stage 4 baseline: 94 restaurants, 6,791 items, +24% over v6). It was never committed — the numbers exist only in run logs.
- **Resolved-but-unmarked:** `menu-data-sources-analysis.md`'s tiered recommendation (UE JSON-LD + FFN/FatSecret) *was* implemented by the UE-first pipeline — the doc reads as an open proposal but is actually a fulfilled one. `data-pipeline-v2.md`'s P0/P1 fixes shipped; P2 calibration did not.
- Minor: `data-pipeline-v3.md:940` still lists `GOOGLE_PLACES_API_KEY` as required (now optional, photo tier-3 fallback only).

### Finding 2 — Auth: 9 docs, no single architecture view, one deprecated spec presented as live

Auth is spread across `backend/` (auth-spec, apple-signin-spec, jwt-middleware-spec, auth-e2e-test-spec), `auth/` (google-signin-validation), and `frontend/` (s-23, s-62, s-63, s-104, s-105).

- `backend/auth-spec.md` (email/password, local JWT_SECRET signing) is **superseded** — production auth is Apple + Google via Supabase `signInWithIdToken`, JWTs verified via JWKS. No JWT_SECRET in code.
- `frontend/s-23-auth-screens.md` describes the email/password splash and SecureStore tokens; production has OAuth buttons and AsyncStorage tokens (S-62/S-63). Nothing marks s-23 as superseded.
- No document describes the end-to-end flow (mobile UX → `/api/auth/{provider}` → Supabase verification → token storage → `requireAuth`).

### Finding 3 — Payments/pricing: the most dangerous staleness in the repo

- `product/specs/business-model.md` is still **all Stripe** (webhooks, Customer Portal, `trial_end: 'now'`). Reality: RevenueCat + Apple IAP, entitlement `pro` (wired on Test Store; prod blocked on ASC products).
- Pricing is inconsistent in four places: `app-store-listing.md` ($30/yr · $5/mo), `launch-plan.md` ($4.99/mo), `payment.tsx` ($29.99/yr · $8.99/mo), and the listing copy promises a 7-day free trial that isn't confirmed wired. This will surface as an App Store review failure or user-facing contradiction.
- `launch-plan.md` is internally inconsistent (header says "RevenueCat (deprecate Stripe)" but the checklist only contains Stripe-removal tasks).
- The *only* doc with the true current payment state is `pre-launch-action-items.md` — which is **untracked in git**.

### Finding 4 — Broken and stale meta/infrastructure docs

| Issue | Location | Severity |
|---|---|---|
| `docs/product/vision.md` referenced but missing | `.claude/agents/product-manager.md:9`, `gtm.md:30` | P0 — agents are told to read it |
| `docs/gtm/strategy.md` referenced but missing | `.claude/agents/gtm.md:9` | P0 |
| `docs/tuning-guide.md` referenced but missing | `CLAUDE.md:207` | P1 |
| `pre-launch-action-items.md` untracked | `docs/product/` | P0 — risk of loss |
| CLAUDE.md "no GPS yet" | `CLAUDE.md:18` | Stale — GPS shipped 2026-04-26 (S-203); sprint-12 even flagged this |
| CLAUDE.md "last audited 2026-04-08" | `CLAUDE.md:12` | 64 days stale; also 222 lines vs. CTO's own 200-line cap |
| `okrs.md` last reviewed 2026-04-08; Phase 3 "Done" while S-207 (TestFlight build) still in backlog | `proj-mgmt/okrs.md` | Stale |
| `.claude/commands/sprint.md` effectively empty | — | Stub; fill or delete |
| `audit-2026-03-25.md` | `docs/engineering/` | Superseded by 2.5 months of shipping; at least 3 claims now false (JWT validation, macro setup, profile screen) |

### Finding 5 — Duplication pairs/clusters (beyond pipeline and auth)

| Cluster | Files | Verdict |
|---|---|---|
| Analytics | `frontend/posthog-analytics-spec.md` (5 events, S-102) vs `frontend/analytics-events.md` (30+ events, Sprint 12) | analytics-events.md is the truth; merge the S-102 doc into it as a historical note |
| Perf | `backend/search-performance-spec.md` (problem analysis) vs `perf-and-security-handoff-2026-04-25.md` (shipped fix) vs `api-perf-followups-spec.md` (open punch list) | Archive the problem analysis (solved); handoff = truth; followups = active |
| App Store | `app-store-listing-spec.md` (requirements) vs `app-store-listing.md` (deliverable) | Keep deliverable, archive spec |
| Launch | `launch-plan.md` vs `pre-launch-action-items.md` | Action-items supersedes; archive launch-plan as pre-launch record |
| TestFlight | `testflight-runbook.md` (build/distribute) vs `testflight-recruiting-runbook.md` (cohort ops) | Genuinely complementary — keep both |
| GTM UGC | `ugc-marketing-playbook.md` / `ugc-pipeline-spec.md` / `content-hooks.md` | Complementary (strategy / implementation / assets) — keep, cross-link |
| EAS config | `s-104` + `s-105` | Both done; archive together |
| Idempotency | `specs/s-82-macro-estimate-upsert.md` vs `backend/idempotent-preload-spec.md` | idempotent-preload-spec is the fuller design; s-82 archive |

### Finding 6 — Design drift

`design/component-library.md`: 5 of 8 spec'd components (MacroPill, MacroChart, MealRow, FilterChip/FilterSheet, TargetBar, MatchScore) were never built; the app shipped ~11 ad-hoc components instead (MacroChips, MacroInputBar, FilterPopup, MenuItemCard, …). Normal MVP drift, but the spec presents itself as current. `design-brief.md` remains accurate at its altitude.

### Finding 7 — Ticket-spec clutter

~20 completed one-off ticket specs (`s-NN-*.md`, crash-fix-spec, mobile-scaffold-spec, s-77/s-82/s-84, s-47, monorepo-scaffolding-spec, scraping-spike, sprint-6-summary…) sit alongside living docs with no status markers. They're valuable history but indistinguishable from active specs.

---

## Part 2 — Proposed Refactor

### Principles

1. **One living doc per system** (pipeline, auth, API, analytics, payments); everything else links to it or is archived.
2. **Status frontmatter on every doc**: `status: living | active-spec | deferred | superseded | archived`, `last-verified: YYYY-MM-DD`, optional `supersedes:` / `superseded-by:`.
3. **A single `archive/` per domain**, files renamed with their era (`scraping-spike-2026-03.md`). Archive = "read for context, never update."
4. **Specs for unbuilt features live under `product/specs/` (the what) and graduate to `engineering/` when implementation begins (the how).**

### Target tree

```
docs/
  README.md                          # NEW — index, status conventions, "where does X go"
  product/
    vision.md                        # NEW — from vision-prd.md; fixes 2 broken agent refs
    roadmap.md                       # NEW — phases incl. Local Legend, Merchant Dashboard, Meal Tweaks
    business-model.md                # REWRITE — RevenueCat + IAP, pricing decision record
    competitors.md                   # keep (finish or cut LeanBites stub)
    feedback-triage.md               # keep
    app-store-listing.md             # keep — reconcile pricing first
    pre-launch-action-items.md       # GIT ADD — promote to canonical launch tracker
    specs/
      TEMPLATE.md
      check-in-local-legend.md       # RENAME check-in.md + extend (see feature section)
      community-feedback-forum.md
      merchant-dashboard.md          # NEW
      meal-tweak-suggestions.md      # NEW
      landing-page.md                # mark status: shipped
      llc-formation.md
    archive/                         # launch-plan.md, app-store-listing-spec.md, vision-prd.md
  engineering/
    architecture/
      system-design.md               # MOVE + refresh pipeline section to UE-first
      auth.md                        # NEW — consolidated end-to-end auth architecture
      api-reference.md               # NEW — merge api-endpoints-spec + jwt-middleware-spec, fix LATERAL/denorm reality
      analytics-events.md            # MOVE from frontend/ — absorb posthog-analytics-spec as history note
      testing-strategy.md            # MOVE — drop "Draft" label
    pipeline/
      ue-first-pipeline.md           # MOVE — primary living spec
      data-pipeline-v3.md            # MOVE — supporting architecture; fix env-var note (line 940)
      runbook.md                     # NEW — UE-first ops (env, --phase flags, resume, common tasks)
      baseline-v6.md                 # NEW — recover missing Stage 4 artifact from run logs
      status.md                      # NEW — stage checklist (spike→schema→orchestrator→baseline→cutover→prod)
    backend/
      idempotent-preload-spec.md     # keep
      api-perf-followups-spec.md     # keep (active punch list)
      perf-and-security-handoff-2026-04-25.md   # keep (truth for perf + parked security)
      security-audit-sprint10.md     # keep (open P0: AsyncStorage JWT / S-103)
    devops/
      production-deployment.md       # REFRESH step 2 → preload-ue-first
      staging-environment.md         # keep
      testflight-runbook.md          # keep
      testflight-recruiting-runbook.md  # keep
      monitoring-alerting.md         # REFRESH — add Axiom dataset + Slack alerts (C0ASM3865AA)
      costs.md                       # REFRESH — current spend & triggers
    archive/                         # ~25 files: all completed s-NN ticket specs, spikes,
                                     # superseded specs (auth-spec, s-23, preload-pipeline-spec,
                                     # search-performance-spec, data-pipeline-v2*, preload-runbook,
                                     # menu-data-sources-analysis, audit-2026-03-25,
                                     # mobile-scaffold, monorepo-scaffolding, crash-fix, s-62, s-63,
                                     # s-104+s-105, s-77, s-82, s-84, s-47, scraping-spike,
                                     # ue-feed-spike-findings, pipeline-v3-hardening†, gps-integration-spec)
  gtm/
    strategy.md                      # NEW — fixes broken gtm agent ref; positions UGC/SEO/merchant motions
    ugc-marketing-playbook.md        # keep
    ugc-pipeline-spec.md             # keep (resolve RPM open question)
    content-hooks.md                 # keep
    llm-seo-discovery-spec.md        # keep (unimplemented — mark status: active-spec)
  design/
    design-brief.md                  # keep
    component-library.md             # add "Implementation Status" table mapping spec → actual components
```

\* `data-pipeline-v2.md`: extract its "Known Bugs & Data Quality Issues" into a "Lessons from V2" section of data-pipeline-v3.md before archiving.
† `pipeline-v3-hardening.md`: close it first — verify C6 (fault-recovery tests) and C7 (LA validation, `la-validation.ts` not found) and write a 5-line completion summary at top.

### Hardcoded references to update during the move (13 sites)

`CLAUDE.md:69` (system-design path), `CLAUDE.md:207` (tuning-guide), `proj-mgmt/backlog.md:8,11`, `proj-mgmt/sprints/sprint-12.md:7,33,37,39,41`, `.claude/agents/gtm.md:9,30`, `.claude/agents/product-manager.md:9,40`, `.claude/agents/designer.md:9`, `.claude/agents/backend.md:15`, `.claude/agents/cto.md:15`, `.claude/agents/frontend.md:15`. After moves, grep `docs/` paths across `.claude/`, `proj-mgmt/`, `CLAUDE.md`, and `docs/` itself for stragglers.

---

## Part 3 — The three new features: where they land

### 1. Local Legend (neighborhood super-user leaderboard)

**Mostly already designed.** `docs/product/specs/check-in.md` (2026-04-27, CURRENT) is the check-in + points + weekly/all-time leaderboard spec, and `proj-mgmt/backlog.md:17` already names "Local Legend" explicitly. Gaps to close:

- Rename/rebrand the spec `check-in-local-legend.md`; add a "Local Legend" section: leaderboard scoped **per neighborhood**, scored by engagement (reviews, photos submitted, check-ins).
- Neighborhood scoping has a natural implementation hook: the pipeline already assigns `homeHex` (H3) to restaurants — user activity can be bucketed to hex-cluster neighborhoods without new geo infrastructure.
- Cross-link from `roadmap.md` (Phase 2) and `gtm/strategy.md` (UGC flywheel: legends produce the photos/reviews the UGC pipeline wants).

### 2. Merchant Dashboard (verified nutrition data + advertising)

**Not documented anywhere — net-new spec.** Create `docs/product/specs/merchant-dashboard.md` covering:

- Merchant onboarding/claim flow + verification (the existing phone-column / `matchRestaurant()` dedupe work in the multi-source matcher plan is the natural claim-matching key).
- **Verified data precedence**: merchant-submitted nutrition overrides pipeline LLM estimates — needs a `source`/`verified` tier on `MacroEstimate` and a UI trust badge (extends the existing ConfidenceBadge concept).
- Advertising/promoted placement as a second revenue line — this is the first non-subscription revenue, so `business-model.md` v2 should gain a "Merchant revenue (future)" section.
- Add a backlog entry (currently missing); reference from `roadmap.md` Phase 3 and `gtm/strategy.md` (merchant partnerships motion).

### 3. Meal Tweak Suggestions (AI tweaks to fit macro targets)

**A one-line backlog seed exists** ("Meal optimization recommendations", `backlog.md:11`) — promote it to a real spec `docs/product/specs/meal-tweak-suggestions.md`:

- UX: suggestion card on item/restaurant detail ("swap fries → side salad: −38g carbs, fits your cut target"), driven by the user's stored macro targets.
- Engineering: reuses the existing Haiku estimation pipeline; tweaks can be generated at preload time (cheap, cacheable per item × goal-archetype) vs. runtime (personalized, costs per request) — spec should decide this explicitly.
- Natural premium feature: reference from `business-model.md` v2 as a `pro`-entitlement differentiator.

---

## Part 4 — Migration plan (4 waves)

**Wave 0 — stop the bleeding (≤30 min, do immediately)**
1. `git add docs/product/pre-launch-action-items.md` + commit.
2. Fix `CLAUDE.md`: GPS claim (line 18), last-audited date, trim to ≤200 lines.
3. Fill or delete `.claude/commands/sprint.md`.

**Wave 1 — truth fixes (½ day)**
4. Decide final pricing once; update `app-store-listing.md`, `payment.tsx`, and record the decision in `business-model.md`.
5. Rewrite `business-model.md` → RevenueCat + IAP (Stripe content to a historical appendix).
6. Add deprecation banners (`status: superseded-by: …`) to the 10 superseded docs *before* moving anything — banners are useful even if the restructure stalls.

**Wave 2 — structure (½ day, mechanical)**
7. Create `architecture/`, `pipeline/`, and `archive/` dirs; `git mv` per the target tree.
8. Update the 13 hardcoded references; grep for stragglers.
9. Add `docs/README.md` index + status-frontmatter convention.

**Wave 3 — new docs (1–2 days, can be sprint tasks)**
10. `product/vision.md` + `gtm/strategy.md` (unblocks PM/GTM agents) and `docs/tuning-guide.md`.
11. `engineering/architecture/auth.md`, `api-reference.md`; pipeline `runbook.md`, `baseline-v6.md`, `status.md`.
12. The three feature specs (local-legend extension, merchant-dashboard, meal-tweak-suggestions) + `roadmap.md`; add merchant dashboard to backlog.

**Wave 4 — keep it clean (ongoing)**
13. Refresh `okrs.md`; decide the sprint-summary policy (sprint-6 is the only one with a summary).
14. Add a recurring "docs audit" task at each phase transition; archive ticket specs at sprint close instead of letting them accumulate.
