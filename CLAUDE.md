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

**Two separate systems — not one:**

The API backend does **not** scrape or estimate macros at runtime.
All restaurant and macro data is preloaded offline by a batch script.
The API backend is a **read-only query layer** over a pre-populated database.

| System | Location | What it does |
|--------|----------|-------------|
| Preload pipeline | `scripts/` | Google Places → Firecrawl → Claude Haiku → PostgreSQL |
| API backend | `apps/api/` | Query + filter preloaded data; no external API calls |

**Preload pipeline (offline batch, run once per area):**
1. **Google Places** Nearby Search → restaurants with `websiteUri` (no Place Details needed)
2. **Firecrawl search** with `scrapeOptions` → finds menu on aggregators (Grubhub, Yelp, zmenu)
3. **Firecrawl map + scrape** → fallback: discover menu pages on restaurant's own site
4. **Claude Haiku** → extract menu items, estimate macros from Markdown
5. Write to PostgreSQL

Cost: ~$5 for 500 restaurants (MVP-0), ~$114 for all LA, ~$1,640 for USA.
Validated in scraping spike: ~85-90% extraction rate. See `docs/engineering/backend/scraping-spike.md`.

**API backend (read-only at runtime):**
- `GET /api/restaurants` — nearby restaurants filtered by macro match, cuisine, chain/indie
- `GET /api/restaurants/[id]/menu` — menu items with cached macros
- `POST /api/meals/estimate` — on-demand ingredient breakdown (post-MVP; Claude call)
- Ranking: by macro match score (not distance — distance is a hard filter via PostGIS `ST_DWithin`)

**Service boundaries:**
- `apps/api/services/restaurant.ts` — query, filter, rank restaurants
- No scraping service, no Claude service at runtime for MVP-0
- Preload script calls external APIs directly (no service wrapper needed)

**Confidence tiers:**
- `medium` — LLM estimated with photo
- `low` — LLM estimated from description only
- `high` — restaurant-published verified data (post-MVP)
- Never show `low` confidence values at full precision: round to nearest 5g

### Database Schema

**Core entities** (full ERD: `docs/engineering/backend/system-design.md`):

| Entity | Key fields |
|--------|-----------|
| `Restaurant` | id, externalPlaceId, name, lat, lng, cuisineTags, chainFlag |
| `MenuItem` | id, restaurantId, name, description, photoUrl, category, price |
| `MacroEstimate` | id, menuItemId, calories, proteinG, carbsG, fatG, confidence, hadPhoto, ingredientBreakdown (JSON), estimatedAt |
| `User` | id, email, name (post-MVP auth) |
| `MacroTarget` | id, userId, calories, proteinG, carbsG, fatG (all optional) |
| `SavedItem` | id, userId, restaurantId/menuItemId (post-MVP) |

**Key indexes:** geospatial on `Restaurant(lat, lng)`, `MenuItem(restaurantId)`, `MacroEstimate(menuItemId)`.
**DB hosting:** Managed PostgreSQL with PostGIS (Neon or Supabase free tier for MVP).

### Authentication

Post-MVP. MVP-0 has no user accounts — macro targets are session-local on the mobile client.
When added: JWT tokens, stored on device via `expo-secure-store`. Auth required for saved items and targets.

### External Services

| Service | Used by | When | Purpose |
|---------|---------|------|---------|
| Google Places API | Preload script | Offline only | Restaurant discovery, `websiteUri` |
| Firecrawl (search/map/scrape) | Preload script | Offline only | Menu retrieval, JS rendering |
| Claude API (Haiku 4.5) | Preload script | Offline only | Menu extraction + macro estimation |
| Claude API (Haiku 4.5) | `apps/api/services/` | Post-MVP on-demand | Ingredient breakdown |
| Yelp Fusion API | — | Post-MVP | Supplementary restaurant data |

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
- **External APIs** — Google Places + Firecrawl + Claude are core
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

- **API**: Vercel or Railway (Next.js). Free tier for MVP.
- **Database**: Neon or Supabase managed PostgreSQL with PostGIS. Free tier for MVP.
- **Mobile**: Expo EAS Build for iOS/Android distribution. TestFlight for beta.
- **Preload script**: Run locally or on a CI runner — not a production service.
- Decision: Neon vs. Supabase — open question, pick before first migration.

---

## Project Management

- **OKR board**: `proj-mgmt/okrs.md`
- **Sprint board**: See `proj-mgmt/sprint.md`
