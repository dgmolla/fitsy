# CLAUDE.md

## Project Vision

Fitsy is a macro-aware restaurant discovery app that helps users find
nearby restaurants with specific meals matching their macronutrient
targets, with optional filtering by cuisine, chain vs. mom-and-pop,
and more.

## Current State

Last audited: 2026-06-12. Full docs audit + refactor: `docs/docs-refactor-proposal-2026-06-11.md`.

**Built and shipped**: Prisma schema + all API routes (filter expansion + `requireAuth` JWT middleware on reads), full mobile auth (Apple + Google Sign-In via Supabase, JWKS-verified — no local secret), 15-screen onboarding, GPS via `expo-location` (wired into search), search/detail/saved/profile screens (editorial cream palette), UE-first preload pipeline (Uber Eats discovery → FatSecret/Brave menus → Haiku macros), search 60× faster (LATERAL + denormalized MenuItem macros), PostHog analytics, security hardening, RevenueCat subscriptions wired on Test Store, EAS build config.

**DB state**: Staging populated — 22+ restaurants, 268+ items (source: fatsecret), 0 duplicates.

**Blocked on human**: EAS Build → TestFlight submission (Apple Developer account + ASC products); RevenueCat production (ASC products, paywall, bundle-id, webhook deploy). No real users yet.

**Next**: TestFlight → first 10 users.

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
│   ├── product/       # vision, roadmap, business-model, specs/, archive/
│   ├── engineering/   # architecture/, pipeline/, backend/, devops/, archive/
│   ├── design/        # design brief, component library
│   └── gtm/           # strategy, ugc-playbook, seo-discovery
├── proj-mgmt/         # OKRs, sprint boards
└── .claude/
    └── agents/        # Role definitions
```

### Key Architecture Decisions

**Two separate systems — not one:** The API backend is a read-only query layer over a pre-populated database — no runtime scraping or macro estimation.

| System | Location | What it does |
|--------|----------|-------------|
| Preload pipeline (UE-first) | `scripts/preload-ue-first.ts` | Uber Eats discovery → FatSecret/Brave menus → Claude Haiku macros → PostgreSQL (H3 hex checkpoints, Axiom telemetry) |
| API backend | `apps/api/` | Query + filter preloaded data; no external API calls |

Architecture: `docs/engineering/architecture/system-design.md` (+ `auth.md`, `api-reference.md`). Pipeline: `docs/engineering/pipeline/` (runbook, status, data-pipeline-v3).
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
This activates a **fast local gate** (`scripts/pre-push.sh`) — runs structural
tests and TypeScript checks before every push. This is a quick filter, not a
substitute for the full Pre-PR Gate above (which also requires `npm test` and
`npm run build`). Catches the most common CI failures in seconds.

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
| `ANTHROPIC_API_KEY` | Macro estimation (Haiku) | console.anthropic.com |
| `UE_LOC_COOKIE` | Uber Eats discovery (preload) | captured cookie |
| `BRAVE_API_KEY` | Indie menu URL discovery (preload) | brave.com/search/api |
| `AXIOM_TOKEN` / `SLACK_BOT_TOKEN` | Pipeline telemetry + alerts | Axiom / Slack |

---

## Code Conventions

- **Language**: TypeScript strict mode
- **Mobile client**: React Native (Expo), Expo Router for navigation
- **API backend**: Next.js API routes (server-only, no pages)
- **Database**: Prisma, always use transactions for multi-record mutations
- **Error responses**: `{ "error": "message" }` with appropriate HTTP status codes
- **Tests**: Write tests for new endpoints. Mock only external services, never your own code.
- **API calls**: All external API calls go through service wrappers in `apps/api/services/`
- **Docs structure**: `docs/` children are domains (product, engineering, design, gtm); subdirs are grandchildren. Superseded/historical docs live in each domain's `archive/`. Index + conventions: `docs/README.md`.
- **Diagrams**: Every spec and design doc must include at least one Mermaid diagram (```mermaid block) of the primary flow/architecture. GitHub and Obsidian render it natively.
- **Single-domain ownership**: Each agent only modifies files it owns (its `.claude/agents/<role>.md` "You Own"). Needed change in another domain → file a ticket for that domain, don't make it yourself. One `#role` tag per card; one reviewer per PR (CI fails multi-domain PRs).

---

## Session Discipline

**Commit before you leave** — every session ends with meaningful work committed, even as `wip:` on a branch. Stashes are invisible to future sessions and cause lost work; never rely on them. **Check for prior work first** — at session start, check `git status` (the SessionStart hook surfaces it) before starting new work.

---

## Pre-PR Gate

CI is a safety net, not a first pass. Run everything locally BEFORE
committing. Fix all failures in your session. Do not open a PR that
you haven't verified passes locally.

```bash
bash scripts/structural-tests.sh                              # structural tests
npx tsc --noEmit                                              # type check
npm test                                                     # unit + integration
npm run build                                                # build (catches what tests miss)
git diff --cached --name-only | grep -E '\.(js|js\.map)$'    # must be empty (no build output)
# E2E: use mobile MCP tools to verify critical flows in the Expo Go simulator
```

**The rule**: if CI would catch it, you should have caught it first.

## Post-PR Gate

You are done when CI and deploy are green, not when you push. After pushing, poll `gh pr checks <PR-NUMBER>` until complete; on failure read the logs (GitHub Actions URL, or `npx vercel inspect <id> --logs` for deploys), push the fix, repeat. Only hand off to the reviewer once everything is green.

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
- **External APIs** — Uber Eats (discovery), FatSecret/Brave (menus), and
  Claude Haiku (macros) are core preload dependencies. Handle rate limits,
  failures, and resume. The runtime API makes no external calls.

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

## Deployment

- **API**: Vercel project `fitsy-api` (Next.js). **Landing**: Vercel project `fitsy` (fitsy.org).
- **Database**: Supabase managed PostgreSQL.
- **Mobile**: Expo EAS Build → TestFlight.
- **Preload**: `scripts/preload-ue-first.ts`, run locally or on CI — not a production service.

## Project Management

- **OKR board**: `proj-mgmt/okrs.md` | **Sprint board**: `proj-mgmt/sprint.md` | **Backlog**: `proj-mgmt/backlog.md`
