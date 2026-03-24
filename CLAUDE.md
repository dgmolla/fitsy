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

**Data Pipeline (MVP):**

Three-stage pipeline: discover → scrape → estimate.

1. **Google Places** Nearby Search → restaurants with `websiteUri`
2. **Firecrawl** → scrape website, return clean Markdown
3. **Claude Haiku** → estimate macros for all menu items (batch)

Two-phase estimation: macros-only for batch preload (cheap),
ingredient breakdown on-demand when user taps a meal.
MVP scope: Los Angeles only. Preload cost: ~$72.

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

- **Google Places API** — restaurant discovery, `websiteUri`, photos
- **Firecrawl** — website scraping, JS rendering, Markdown conversion
- **Claude API (Haiku)** — macro estimation, menu extraction
- **Yelp Fusion API** — supplementary restaurant data (optional, post-MVP)

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
- **Single-domain ownership**: Each agent only modifies files it owns (listed in its `.claude/agents/<role>.md` under "You Own"). If your task requires changes in another domain, do NOT make those changes yourself — create a separate ticket for that domain's agent. This applies at every level:
  - **Tickets**: one `#role` tag per sprint card. Cross-domain tasks must be split into subtasks before work begins.
  - **Implementation**: only edit files in your domain. If you discover a needed change outside your domain, note it and move on.
  - **PRs**: every PR must route to exactly one reviewer. Enforced by CI — PRs touching multiple domains will fail.

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
