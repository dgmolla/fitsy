# CLAUDE.md

## Project Vision

Fitsy is a macro-aware restaurant discovery app that helps users find
nearby restaurants with specific meals matching their macronutrient
targets, with optional filtering by cuisine, chain vs. mom-and-pop,
and more.

## Current State

### What Works
- Foundation docs complete: Vision PRD, System Design, Design Brief, Business Model, Component Library spec
- Scraping pipeline validated: Firecrawl search + map + Haiku v3, ~85-90% menu extraction rate on 90029 test

### What's Missing
1. Prisma schema and database migration
2. Preload script (Google Places → Firecrawl → Claude Haiku → PostgreSQL)
3. API backend: restaurant query + macro filtering endpoints
4. Mobile UI (React Native / Expo)
5. CI/CD pipeline

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

**Two separate systems — not one:** The API backend is a read-only query layer over a pre-populated database — no runtime scraping or macro estimation.

| System | Location | What it does |
|--------|----------|-------------|
| Preload pipeline | `scripts/` | Google Places → Firecrawl → Claude Haiku → PostgreSQL |
| API backend | `apps/api/` | Query + filter preloaded data; no external API calls |

Full details — pipeline steps, cost, endpoints, service boundaries, confidence tiers, DB schema, auth, and external services: `docs/engineering/backend/system-design.md`.
---

## Development Commands

### Commands
```bash
npm run dev:api        # API dev server
npm run dev:mobile     # Expo dev client
npm test               # Run tests
npx prisma migrate dev # Run migrations
```

### Git Hooks Setup (one-time, per clone)
```bash
git config core.hooksPath .githooks
```
This activates the pre-push gate (`scripts/pre-push.sh`) — runs structural
tests and TypeScript checks locally before every push. Catches CI failures
before they hit GitHub Actions.

### Environment Variables
Managed via Vercel CLI. All secrets live in Vercel → auto-synced to deploys.
```bash
vercel env ls              # List all env vars
vercel env pull .env.local # Pull to local dev
vercel env add KEY prod    # Add/update a secret
```
| Variable | Purpose | Source |
|----------|---------|--------|
| `POSTGRES_PRISMA_URL` | DB connection (pooled) | Supabase integration |
| `POSTGRES_URL_NON_POOLING` | DB migrations (direct) | Supabase integration |
| `GOOGLE_PLACES_API_KEY` | Restaurant discovery | Google Cloud Console |
| `FIRECRAWL_API_KEY` | Menu scraping | firecrawl.dev |
| `ANTHROPIC_API_KEY` | Macro estimation (Haiku) | console.anthropic.com |

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

# 6. E2E staging (main only — runs post-merge via Maestro)
# maestro test e2e/flows/
```

**The rule**: if CI would catch it, you should have caught it first.

## Post-PR Gate

You are not done when you push. You are done when CI and deploy are green.

1. After pushing, poll `gh pr checks <PR-NUMBER>` until all checks complete
2. If any check fails, read the failure logs and fix the issue
   - CI failures: check the GitHub Actions log URL from `gh pr checks`
   - Vercel deploy failures: `npx vercel inspect <deployment-id> --logs`
3. Push the fix and repeat until all checks pass
4. Only hand off to the reviewer once everything is green

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
- **External APIs** — Google Places + Firecrawl + Claude are core
  dependencies. Handle rate limits, failures, and caching.

---

## Shipyard Settings

| Knob | Value |
|------|-------|
| human-review-gate | cruise |
| spec-requirement | always |
| auto-merge | on-approval |
| active-roles | all |
| wave-progression | auto |

See `docs/tuning-guide.md` for what each knob does and when to change it.
---

## Deployment

- **API**: Vercel or Railway (Next.js). Free tier for MVP.
- **Database**: Neon or Supabase managed PostgreSQL with PostGIS (pick before first migration).
- **Mobile**: Expo EAS Build. TestFlight for beta.
- **Preload script**: Run locally or on CI runner — not a production service.

---

## Project Management

- **OKR board**: `proj-mgmt/okrs.md` | **Sprint board**: `proj-mgmt/sprint.md`
