# AGENTS.md

## Project Vision

Fitsy is a macro-aware restaurant discovery app that helps users find
nearby restaurants with specific meals matching their macronutrient
targets, with optional filtering by cuisine, chain vs. mom-and-pop,
and more.

## Where to start

Read [API](apps/api/AGENTS.md), [mobile](apps/mobile/AGENTS.md), or [shared](packages/shared/AGENTS.md) instructions for package commands and boundaries.
Current issue scope, deployment state, evidence and next actions belong in the issue or task handoff.

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
├── AGENTS.md
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
| Preload pipeline (UE-first) | `scripts/preload-ue-first.ts` | Uber Eats discovery and menus → reviewed official or Haiku macros → PostgreSQL (H3 hex checkpoints, Axiom telemetry) |
| Pipeline v2 DEV proof | `scripts/preload-v2.ts` | Explicit single LA hex, reviewed exact official matches + Jev, $5 journal cap; [runbook](docs/engineering/pipeline/pipeline-v2-dev-poc.md) |
| Pipeline v2 shared DEV queue | `scripts/preload-v2.ts enqueue/worker` | Leased hex jobs, shared paid-call replay, atomic completion and bounded retries; [runbook](docs/engineering/pipeline/pipeline-v2-queue.md) |
| Pipeline v2 cloud DEV worker | `scripts/pipeline-cloud-worker.ts` | Private service, immutable fleet run limits, health and graceful shutdown; [deployment and acceptance](docs/engineering/pipeline/pipeline-v2-cloud-worker.md) |
| API backend | `apps/api/` | Query + filter preloaded data; only auth/subscription provider lookups at request time |

Architecture: `docs/engineering/architecture/system-design.md` (+ `auth.md`, `api-reference.md`). Pipeline: `docs/engineering/pipeline/` (runbook, ue-first-pipeline, macro-accuracy-recommendations-2026-08-16).
---

## Development Commands

### Commands
```bash
npm run dev:env        # Pull DEV env creds (api .env.local, mobile .env.development.local, .env.dev)
npm run dev:api        # API dev server (talks to the dev DB by default)
npm run dev:mobile     # Expo dev client
npm test               # All workspace tests; package commands are in their AGENTS.md
npm run perf:check     # Stable performance invariants (no network timing gate)
npm run perf:bundle    # Local production iOS JS size budget; never publishes
npm run verify:dependencies # Live full and production dependency audits with retained evidence
npx prisma migrate dev # Run migrations
```

Environments: ephemeral (CI + `prisma/seed.ts`), **dev** (`fitsy-dev` Supabase: previews, local, simulator), prod. `docs/engineering/devops/staging-environment.md`; `scripts/dev/` refuses prod.
Database tests require a disposable loopback database and refuse shared DEV and PROD before suites load; the owned setup is documented in [verification](scripts/verify/README.md).
Dependency upgrades and live audits require registry access; use the existing network-enabled owner when a worker is restricted, following [dependency audit evidence](scripts/verify/README.md#live-dependency-audit-evidence).
Performance baselines, dev API sampling and native profiling: [performance runbook](docs/engineering/devops/performance.md).

### Git Hooks Setup (one-time, per clone)
```bash
git config core.hooksPath .githooks
```
`npm install` wires this automatically through the `prepare` script.
The hook runs size/domain checks, cheap static checks and focused tests before every push.
It works with an ordinary checkout and installed dependencies; GitHub owns merge requirements and heavy validation.

### Environment Variables
Managed via Vercel CLI. All secrets live in Vercel → auto-synced to deploys. `Production` holds prod creds; `Preview` and `Development` hold the dev environment's.
```bash
vercel env ls              # List all env vars
vercel env pull .env.local # Pull to local dev
vercel env add KEY prod    # Add/update a secret
```
| Variable | Purpose | Source |
|----------|---------|--------|
| `POSTGRES_PRISMA_URL` | App queries and account writes (`fitsy_app`, pooled) | Vercel role binding |
| `POSTGRES_URL_NON_POOLING` | DB migrations (direct) | Supabase integration |
| `PIPELINE_DATABASE_URL` | Pipeline writes (`pipeline_writer`, session/direct) | Private pipeline environment |
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
- **Menu identity**: Preserve provider-qualified source IDs and stable Fitsy dish IDs; follow the [persistence and cutover contract](docs/engineering/backend/idempotent-preload-spec.md).
- **Error responses**: `{ "error": "message" }` with appropriate HTTP status codes
- **Tests**: Assert observable behavior with independent expected outcomes and deterministic fixtures.
  Mock external boundaries, keep core logic real, and use the disposable database for persistence behavior.
- **API calls**: All external API calls go through service wrappers in `apps/api/services/`
- **Search scope**: Ranking, qualification, query relevance, filters, pagination and serving interpretation are product behavior.
  Onboarding, presentation, paywall and marketing work must preserve that policy unless the issue explicitly requests a search change.
  For a search fix, reproduce the real journey and verify preview and authenticated search with default targets, common cravings such as pizza, restaurant/cuisine names, sparse or absent matches, clearing the query and affected pagination.
  API agreement or a successful empty state alone does not prove useful search behavior.
- **Docs structure**: `docs/` children are domains (product, engineering, design, gtm, release); subdirs are grandchildren.
  Superseded/historical docs live in each domain's `archive/`.
  Index + conventions: `docs/README.md`.
- **Diagrams**: Every spec and design doc must include at least one Mermaid diagram (```mermaid block) of the primary flow/architecture. GitHub and Obsidian render it natively.
- **Outcome ownership**: One execution owner coordinates each coherent issue and PR, including API and mobile changes when their contract evolves together.
  Assign clear file ownership to collaborating agents, and involve the relevant domain owner or reviewer for changed behavior.
  The domain and size checks report review scope; they do not require a layer split or impose a hard line cap.
  Keep required product, security, and acceptance checks for every affected surface.

---

## Agent routing

The human-selected standalone Pstack orchestrate-delivery, ship-branch and verify-fitsy skills supplied by the coordinator control orchestration and shipping.
Repository documents retain product, supported command, security/data and release contracts.
Follow [model routing and delegation](docs/engineering/devops/agent-model-routing.md) for configured model and independent review protections.
The installed local reviewer owns source-bound independent review; standing human execution exceptions supersede historical attempt limits.
Preserve historical review records needed by unfinished tasks.

## Session Discipline

**Commit before you leave** — every session ends with meaningful work committed, even as `wip:` on a branch. Stashes are invisible to future sessions and cause lost work; never rely on them. **Check for prior work first** — at session start, check `git status` (the SessionStart hook surfaces it) before starting new work.

---

## Pre-PR Gate

Follow `docs/engineering/devops/shipping.md` for supported commands, acceptance, release protections and finding priorities under the selected skills.

Publish after meaningful cheap checks, focused regressions and a matching independent review of the frozen candidate.
The trusted existing public Verify workflow supplies heavy validation before protected merge.
Keep applicable real-media/native journeys and release approvals explicit; a hook pass or a same-named CI status is not acceptance.

```bash
npm run verify -- --stage=cheap   # structural, safety, lint, types and selected focused tests before review
# Obtain independent review, then publish through the ordinary pre-push hook.
# Optional local full diagnostics retain their normal contracts:
npm run verify         # layers 0-2 on your changes (structural, secrets, lint, types, tests)
npm run verify:all     # everything, including the production build
# E2E: use saved Maestro YAML flows and Maestro MCP on the local simulator
```

The check list lives in `scripts/verify/registry.yml`; CI (`verify.yml`), the
pre-push hook, and agents all run the same scripts.
All verifier callers retain complete check logs; see [diagnostic recovery](scripts/verify/README.md#diagnostic-logs) for local paths and CI artifacts.
Inspect dynamic simulator scope with `npm run verify:sim-plan`; selection and render checkpoints live in `scripts/verify/impact-plan.mjs`.
CI posts the `Sim scope` selection on the PR head and uploads `selection.json`; it never runs simulators or needs simulator credentials.
The classifier is read-only; the protected `sim-scope.yml` publisher records a bounded scope/count description, with exact flows retained in the artifact.
Simulator runs locally on the maintainer Mac via the sim-review poller, which posts the Simulator status; merges wait for it when scope is not none.
Every mobile/web UI edit triggers local coverage: screen-local style/copy uses render smoke, behavior uses affected E2E, and shared UI/app shells use the full suite.
Local execution and final product acceptance share the affected-flow plan; omitted flows have explicit reasons, and explicit lists can only expand required coverage.
Inspect `npm run verify:product-plan` for mandatory journeys and MCP categories before acceptance; use a compatible existing binary or a supported build without requiring a shared cache.
The ordinary native build entrypoint also checks the optional [shared immutable cache](docs/engineering/devops/native-binary-reuse.md#shared-native-cache); imported build receipts never substitute for current-source Metro or acceptance.
Run `node scripts/sim/ci.mjs --scope=<none|smoke|flow|full> --flows=<comma-list> --udid=<UDID>` with configuration from the local machine.
Optional `--record-video` adds non-fatal Slack previews; see [runner controls](scripts/sim/native-runner-controls.md#optional-slack-previews) for the poller wrapper and evidence contract.
Keep `dev.fitsy.org` pinned to `dev`; candidate API changes use the PR's Ready `fitsy-api` preview via the same `EXPO_PUBLIC_API_URL` in Metro, Maestro and every fixture.
Account-dependent journeys require local fixture preparation and compatible store builds as documented in `apps/mobile/e2e/README.md`.
Keep simulator smoke out of the pre-push hook.

Protected merge requires current trusted CI plus applicable local media/native evidence; old-head CI and candidate-controlled workflow changes cannot substitute.
GitHub requires `Verify` and `AI review` on the current PR head.
Local shipping helpers run checks directly and do not require an approval App installation.

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

- **Auth** - every data handler requires a Supabase account session, including onboarding samples; see `apps/api/app/api/auth-coverage.test.ts` for exact public exceptions.
  User accounts and session management are security-sensitive.
- **Database access** - Prisma serves application data; keep default-deny RLS and no direct client grants on every application table, including migration-managed operational tables.
  Audit live Supabase catalogs with `scripts/security/supabase-audit.sql` in its read-only transaction; see `scripts/verify/security-schema.test.ts` and the real-DB regression.
- **Data integrity (nutrition estimates)** — LLM-estimated macros are
  approximate; users may make health decisions based on this data.
  Always show confidence ranges, never false precision.
- **External APIs** - Uber Eats supplies discovery and location menus; reviewed official facts and
  Haiku or Jev supply nutrition. Handle rate limits,
  failures, and resume.
  Runtime restaurant queries never call discovery, menu or macro-estimation providers.

---

## Shipyard Settings

Verification settings live in `scripts/verify/registry.yml` alongside their checks.
Review routing uses `scripts/route-reviewers.sh`, with severity and evidence rules in `REVIEW.md`.
See `docs/engineering/tuning-guide.md` for the maintained settings reference.
Existing GitHub merge requirements remain authoritative; local tooling cleanup does not change them.

## Deployment

- **API**: Vercel project `fitsy-api` (Next.js). **Landing**: Vercel project `fitsy` (fitsy.org).
- **Database**: Supabase managed PostgreSQL.
- **Mobile**: Expo EAS Update for compatible JavaScript; EAS Build for native changes and approved store distribution.
- **Preload**: local commands target DEV or disposable fixtures; production ingestion requires an approved cloud worker and signed workload identity. See [the execution boundary](docs/engineering/pipeline/runbook.md#environment-variables).

### OTA vs native build

JS, styles and assets bundled by JavaScript can reach compatible TestFlight binaries through EAS Update after green Verify and production smoke.
New native modules, permissions, config plugins, icon/splash changes, Expo SDK upgrades and widget/Swift changes require a new verified binary.
Run `node scripts/deploy/native-compatibility.mjs`; a missing baseline fingerprint fails closed.
Build 6 uses the fingerprint runtime and `testflight` channel; the [binary baseline contract](docs/engineering/devops/ios-ota-baseline.md) retains separate TestFlight and historical production evidence.
The [OTA channel policy](scripts/deploy/ota-policy.json) targets automatic `testflight`; set `app_store_launched: true` before an actual App Store launch.
App Store production OTA requires Dawit's explicit manual Deploy dispatch and existing protected release approval; see [binary evidence and channel cutover](docs/engineering/devops/ios-ota-baseline.md).

## Project Management

- Follow [task management](docs/engineering/devops/task-management.md) for the GitHub Project queue, exclusive execution ownership, worker lifecycle, progress updates, and delivery timestamps.
- `proj-mgmt/` retains planning/reference material; do not maintain a competing active task queue.
- Run `scripts/delivery/cleanup.py <private-records.json>` on demand; dry-run is the default and deletion requires `--apply`.
  Follow the [cleanup record contract](docs/engineering/devops/local-dispatcher.md#admission-and-manual-cleanup); preserve active, dirty, unmerged, shared and uncertain resources, with actual inactivity strictly over four hours.
  Do not install a cleanup scheduler or launchd job.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
