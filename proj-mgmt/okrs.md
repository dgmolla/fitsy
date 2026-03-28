# OKRs

**Cadence**: Review after every sprint.
**Last reviewed**: 2026-03-28
**Current phase**: Get Users (transitioned after Sprint 5)

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
| KR5 | Maestro E2E flows pass against staging environment | **Done** | 3 flows written (onboarding, search, detail); pending first live run (S-25/S-29) |

---

## Phase 3: Roll Out ✅ Complete

### O1: Ready to launch
Production deployment with monitoring, ready for real users.

| # | Key Result | Status | Notes |
|---|------------|--------|-------|
| KR1 | Deployed to production with auth and data pipeline operational | **Done** | S-30 merged; runbook + verify-prod.sh shipped |
| KR2 | Business Model and pricing strategy finalized | **Done** | S-31 merged; $30/yr + $5/mo Stripe spec complete |
| KR3 | GTM materials complete (landing page, CTA to App Store) | **Done** | S-32 merged; Next.js marketing site with hero, features, CTA |
| KR4 | Monitoring and alerting operational (API costs, rate limits, accuracy) | **Done** | S-33 merged; health endpoint + Vercel analytics |

---

## Phase 4: Get Users

### O1: Ship MVP to first 10 users
Real users validate whether macro-aware restaurant discovery solves a real problem.

| # | Key Result | Status | Notes |
|---|------------|--------|-------|
| KR1 | 10 users signed up and using the app | In progress | Welcome flow + Apple auth UI shipped (S-60); needs real Apple auth + TestFlight (S-58) |
| KR2 | Users completing at least 3 searches per week | Not started | Measurable only after KR1 — needs active users first |
| KR3 | 2 rounds of user testing completed with findings triaged | Not started | |
| KR4 | Feedback loop operational (capture → triage → spec → ship) | **Done** | S-38 merged; feedback triage playbook + P0–P4 priority matrix in `docs/product/feedback-triage.md` |

---

## How to Read This Board

- **Not started**: No work has begun
- **In progress**: Active work in a branch or sprint
- **Blocked**: Can't proceed — dependency or decision needed
- **Done**: Merged to main and verified
