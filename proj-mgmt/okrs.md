# OKRs

**Cadence**: Review after every sprint.
**Last reviewed**: 2026-06-12
**Current phase**: Get Users (transitioned after Sprint 5; currently on ~Sprint 12)

---

## The Four Phases

Every project progresses through these phases. Your OKRs should
reflect whichever phase you're in.

1. **Foundation** — Vision, architecture, brand identity, devops ✅
2. **Implement** — Build the product based on the foundation ✅
3. **Roll Out** — Deployment, GTM strategy, business model, pricing, launch prep ✅
4. **Get Users** — Launch, grow, iterate ← current

---

## Phase 1: Foundation ✅ Complete

### O1: Establish the project foundation
We can't build what we haven't defined. Foundation docs become
the context that makes every agent task better.

| # | Key Result | Status | Notes |
|---|------------|--------|-------|
| KR1 | Vision PRD, System Design, and Design Brief complete and approved | **Done** | Merged in PR #2 |
| KR2 | Business Model and GTM Strategy drafted | Not started | Moved to Phase 3 — redo after MVP is built |
| KR3 | CI/CD pipeline operational with structural tests | **Done** | Structural + security running; typecheck/test/build activate when code exists |
| KR4 | CLAUDE.md fully populated with architecture and conventions | **Done** | Populated in PR #6 |

### O2: Validate the tiered macro estimation approach
The pipeline is the core differentiator — nail the design before building.

| # | Key Result | Status | Notes |
|---|------------|--------|-------|
| KR1 | System design documents pipeline with data flow and caching strategy | **Done** | Simplified to single LLM pipeline (no tiers); scraping spike validated v3 approach at ~85-90% hit rate |
| KR2 | Data model for macro cache designed and reviewed | **Done** | 6 entities in system design ERD; MacroEstimate entity covers caching |
| KR3 | Testing strategy covers accuracy validation | **Done** | Separate accuracy validation process + chain dataset defined |

---

## Phase 2: Implement ✅ Complete

### O1: Core product works end to end
Fitsy's macro pipeline, restaurant discovery, and UI all work together.

| # | Key Result | Status | Notes |
|---|------------|--------|-------|
| KR1 | Preload pipeline runs for LA (90029 zip code) and persists results | **Done** | Merged in PR #17 (S-11) |
| KR2 | API returns restaurants ranked by macro match from preloaded data | **Done** | Merged in PR #18 (S-12/S-13/S-14) |
| KR3 | Mobile app shows search results with macro breakdowns | **Done** | Auth + search + detail + macro inputs all shipped (S-16 through S-23) |
| KR4 | Test coverage on macro scoring and API contracts ≥80% | **Done** | 69 API tests, >90% statement coverage across all modules (S-21/S-18) |
| KR5 | E2E smoke tests pass against staging environment | **Revised** | Maestro/Detox removed (RN 0.81 compat issues); E2E now via mobile MCP locally |

---

## Phase 3: Roll Out ✅ Complete

### O1: Ready to launch
Production deployment with monitoring, ready for real users.

| # | Key Result | Status | Notes |
|---|------------|--------|-------|
| KR1 | Deployed to production with auth and data pipeline operational | **Done** | S-30 merged; runbook + verify-prod.sh shipped; UE-first pipeline (preload-ue-first.ts) now live |
| KR2 | Business Model and pricing strategy finalized | **Partial** | S-31 merged; pricing spec was Stripe-based. Reality: RevenueCat + Apple IAP (`pro` entitlement) wired on Test Store; prod blocked on ASC products. Pricing TBD (decide before App Store submission). |
| KR3 | GTM materials complete (landing page, CTA to App Store) | **Done** | S-32 merged; Next.js marketing site on fitsy.org with hero, features, CTA |
| KR4 | Monitoring and alerting operational (API costs, rate limits, accuracy) | **Done** | S-33 merged; health endpoint + Vercel analytics + Axiom pipeline telemetry (`fitsy-pipeline`) + Slack alerts (C0ASM3865AA) |

---

## Phase 4: Get Users

### O1: Ship MVP to first 10 users
Real users validate whether macro-aware restaurant discovery solves a real problem.

| # | Key Result | Status | Notes |
|---|------------|--------|-------|
| KR1 | 10 users signed up and using the app | **Blocked** | Auth shipped (Apple Sign-In S-94, Google Sign-In S-99), GPS live, PostHog analytics live (S-102), onboarding shipped (~Sprint 10–12), EAS build config ready (S-104/S-105). **0 real users as of 2026-06-12 — pre-launch.** Blocker: S-207 EAS Build → App Store submission is human-gated (requires Apple Developer account setup, provisioning profiles, ASC products). No TestFlight beta — light user testing was sufficient; going direct to the App Store. No user numbers to report yet. |
| KR2 | Users completing at least 3 searches per week | Not started | Measurable only after KR1 — needs active users first |
| KR3 | User testing informs launch | **Descoped → light testing** | The formal 2-round TestFlight beta (S-208–S-212) was cancelled 2026-06-12 — light user testing was deemed sufficient. Findings folded into the launch build; no further beta rounds gate the App Store submission. |
| KR4 | Feedback loop operational (capture → triage → spec → ship) | **Done** | S-38 merged; feedback triage playbook + P0–P4 priority matrix in `docs/product/feedback-triage.md` |

---

## How to Read This Board

- **Not started**: No work has begun
- **In progress**: Active work in a branch or sprint
- **Blocked**: Can't proceed — dependency or decision needed
- **Done**: Merged to main and verified
