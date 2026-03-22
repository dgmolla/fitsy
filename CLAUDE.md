# CLAUDE.md

## Project Vision

Fitsy is a macro-aware restaurant discovery app that helps users find
nearby restaurants with specific meals matching their macronutrient
targets, with optional filtering by cuisine, chain vs. mom-and-pop,
and more.

## Current State

### What Works
- Nothing yet — project scaffolding only

### What's Missing
1. Core macro-matching engine (LLM menu parsing → Nutritionix lookup)
2. Restaurant discovery (location-based, Google Places / Yelp)
3. User accounts and saved macro targets
4. Filtering system (cuisine, chain/independent, etc.)
5. Frontend UI

---

## Architecture

### Repository Structure
```
fitsy/
├── CLAUDE.md
├── src/
│   ├── app/           # Next.js App Router pages
│   ├── components/    # React components
│   ├── lib/           # Shared utilities, API layer
│   └── services/      # Backend services, external API wrappers
├── prisma/            # Database schema and migrations
├── scripts/           # Structural tests, harness metrics
├── docs/
│   ├── product/       # Vision, specs, feedback
│   ├── engineering/   # ADRs, backend, frontend, devops
│   ├── design/        # Design brief, component specs
│   └── gtm/           # GTM strategy, launch plans
├── proj-mgmt/         # OKRs, sprint boards
└── .claude/
    └── agents/        # Role definitions
```

### Key Architecture Decisions

**Tiered Macro Estimation Pipeline:**

Each menu item goes through the highest-confidence tier available:

1. **Tier 1 — Verified data**: Check if macros are already publicly
   available (Nutritionix chain DB, restaurant website, etc.)
   Confidence: high.
2. **Tier 2 — Photo estimation**: If menu item has photos, use
   vision model to identify ingredients and estimate portions.
   Confidence: medium.
3. **Tier 3 — LLM description parsing**: No photos available — LLM
   estimates ingredients and portions from menu item name/description.
   Confidence: low.
4. **Nutritionix lookup**: Map identified ingredients + portions →
   per-ingredient macros via Nutritionix API. Sum for total.

Results are persisted per menu item (see Macro Cache below) so we
only estimate once per item. Show confidence tier to users —
never false precision on lower tiers.

**Macro Cache:** Estimated macros are stored per menu item with
tier, timestamp, and source. Stale data is re-estimated periodically.
Details in system design doc (`docs/engineering/backend/`).

### Database Schema

<!-- Fill in after system design -->

### Authentication

<!-- NextAuth.js or similar — define in system design -->

### External Services

- **Google Places API** — restaurant discovery, menus
- **Nutritionix API** — verified nutrition data (chains)
- **Claude API** — menu item parsing, ingredient identification
- **Yelp Fusion API** — supplementary restaurant data (optional)

---

## Development Commands

### Build & Run
```bash
npm run dev            # Dev server
npm run build          # Production build
npm start              # Production start
```

### Tests
```bash
npm test               # Run tests
npm run test:coverage  # With coverage
```

### Database
```bash
npx prisma migrate dev  # Run migrations
npx prisma db seed      # Seed data
```

### Required Environment Variables
| Variable | Purpose | Where |
|----------|---------|-------|
| `DATABASE_URL` | Database connection | Backend |
| `GOOGLE_PLACES_API_KEY` | Restaurant discovery | Backend |
| `NUTRITIONIX_APP_ID` | Nutrition data | Backend |
| `NUTRITIONIX_API_KEY` | Nutrition data | Backend |
| `ANTHROPIC_API_KEY` | Menu parsing LLM | Backend |
| `NEXTAUTH_SECRET` | Auth sessions | Backend |

---

## Code Conventions

- **Language**: TypeScript strict mode
- **Style**: Next.js App Router patterns, server components by default
- **Database**: Prisma, always use transactions for multi-record mutations
- **Error responses**: `{ "error": "message" }` with appropriate HTTP status codes
- **Tests**: Write tests for new endpoints. Mock only external services, never your own code.
- **API calls**: All external API calls go through service wrappers in `src/services/`
- **Docs structure**: `docs/` children are domains (product, engineering, design, gtm). Domain-specific subdirs are grandchildren. No domain-specific dirs directly under `docs/`.

---

## Pre-PR Gate

CI is a safety net, not a first pass. Run everything locally BEFORE
committing. Fix all failures in your session. Do not open a PR that
you haven't verified passes locally.

```bash
# 1. Structural tests (seconds)
bash scripts/structural-tests.sh

# 2. Type check (seconds)
npx tsc --noEmit

# 3. Unit + integration tests (seconds-minutes)
npm test

# 4. Build (catches issues tests miss)
npm run build

# 5. No build output committed
git diff --cached --name-only | grep -E '\.(js|js\.map)$' # should be empty
```

**The rule**: if CI would catch it, you should have caught it first.

## Harness Principles

1. **Every bug hardens the harness at two levels.**
   - **Detect**: Add a test or check that catches the bug next time.
   - **Constrain or Eliminate**: Make the bug harder or impossible to write.

2. **The codebase is the prompt.** Agents follow patterns they see in
   existing code. Improve the patterns, and every future task benefits.

3. **The harness closes its own loops.** If it can detect a problem,
   it must also be able to fix it autonomously.

---

## Danger Zones

- **Auth** — user accounts, session management
- **Data integrity (nutrition estimates)** — LLM-estimated macros are
  approximate; users may make health decisions based on this data.
  Always show confidence ranges, never false precision.
- **External APIs** — Google Places + Nutritionix + Claude are core
  dependencies. Handle rate limits, failures, and caching.

---

## Shipyard Settings

| Knob | Value |
|------|-------|
| human-review-gate | specs-only |
| spec-requirement | always |
| auto-merge | on-approval |
| active-roles | all |
| wave-progression | auto |

See `docs/tuning-guide.md` for what each knob does and when to change it.

---

## Deployment

<!-- Fill in when deployment strategy is decided -->

---

## Project Management

- **OKR board**: `proj-mgmt/okrs.md`
- **Sprint board**: See `proj-mgmt/sprint.md`
