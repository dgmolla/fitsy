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
5. Mobile UI (React Native / Expo)

---

## Architecture

### Platform

**React Native (Expo) mobile client + Next.js API backend** (monorepo).
Mobile is the first-class experience — restaurant discovery is an
on-the-go use case. The backend handles all business logic, external
API keys, macro pipeline, and caching server-side.

### Repository Structure
```
fitsy/
├── CLAUDE.md
├── apps/
│   ├── mobile/        # React Native (Expo) — iOS/Android client
│   │   ├── app/       # Expo Router screens
│   │   ├── components/# React Native components
│   │   └── lib/       # Client utilities, API client layer
│   └── api/           # Next.js API backend
│       ├── app/api/   # API routes
│       ├── lib/       # Server utilities, data access layer
│       └── services/  # External API wrappers
├── packages/
│   └── shared/        # Shared types, constants, validation
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

**LLM Macro Estimation Pipeline (MVP):**

Single pipeline — every menu item goes through one Claude API call:

- **Input**: menu item name + description + optional photo
- **Output**: total macros (P/C/F/cal) + ingredient breakdown + confidence
- **Confidence**: medium (with photo) / low (without photo)
- Ingredient breakdown shown to users for transparency
- No verified data tier at MVP — post-MVP accuracy upgrade

Results are persisted per menu item (see Macro Cache below) so we
only estimate once per item. Show confidence tier to users —
never false precision on lower tiers.

**Macro Cache:** Estimated macros are stored per menu item with
tier, timestamp, and source. Stale data is re-estimated periodically.
Details in system design doc (`docs/engineering/backend/`).

### Database Schema

<!-- Fill in after system design -->

### Authentication

<!-- Define in system design — likely token-based (JWT) for mobile client -->

### External Services

- **Google Places API** — restaurant discovery, menus, photos
- **Claude API** — macro estimation (returns macros + ingredient breakdown)
- **Yelp Fusion API** — supplementary restaurant data (optional)

---

## Development Commands

### Build & Run
```bash
npm run dev:api        # API dev server
npm run dev:mobile     # Expo dev client
npm run build:api      # Production API build
npm run start:api      # Production API start
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
| `ANTHROPIC_API_KEY` | Menu parsing LLM | Backend |
| `JWT_SECRET` | Auth token signing | Backend |

---

## Code Conventions

- **Language**: TypeScript strict mode
- **Mobile client**: React Native (Expo), Expo Router for navigation
- **API backend**: Next.js API routes (server-only, no pages)
- **Database**: Prisma, always use transactions for multi-record mutations
- **Error responses**: `{ "error": "message" }` with appropriate HTTP status codes
- **Tests**: Write tests for new endpoints. Mock only external services, never your own code.
- **API calls**: All external API calls go through service wrappers in `apps/api/services/`
- **Docs structure**: `docs/` children are domains (product, engineering, design, gtm). Domain-specific subdirs are grandchildren. No domain-specific dirs directly under `docs/`.
- **Diagrams**: Every spec and design doc must include at least one Mermaid diagram (```mermaid code block) illustrating the primary data/control flow or architecture. Use Mermaid in markdown — GitHub and Obsidian render it natively.

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
