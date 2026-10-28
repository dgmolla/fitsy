# Environments

> **Status:** Living · **Last verified:** 2026-08-29 · **Owner:** CTO
> Supersedes the single-database design (S-24). Companion to `autonomous-shipping.md` §3 Environments.

## Why this changed

Until 2026-08 one Supabase project served production, local dev, the preload pipeline, and Vercel previews.
That was defensible while the API was a read-only query layer with no users.
With real users and automated E2E that registers accounts and saves items, it produced test pollution in production (224 test users purged on 2026-08-26) and made it unsafe to let agents verify their own work.

## The three environments

```mermaid
graph LR
    subgraph ephemeral["ephemeral (CI / docker)"]
        C[(Postgres + PostGIS container)]
    end
    subgraph dev["dev (fitsy-dev Supabase)"]
        D[(dev DB + dev auth)]
        P[Vercel preview per PR] --> D
        DA[stable dev API<br/>dev.fitsy.org] --> D
        L[local npm run dev:api] --> D
        SIM[simulator / dev client] --> DA
    end
    subgraph prod["prod"]
        PR[(prod DB + prod auth)]
        V[fitsy-api.vercel.app] --> PR
        PIPE[preload pipeline] --> PR
    end
    main[(push to main)] --> V
    main -. mirror-dev-branch.yml .-> DA
```

| Env | What | Data | Schema | Used by |
|---|---|---|---|---|
| **ephemeral** | Worktree-owned PostGIS container launched by `scripts/verify/run.mjs` locally and in hosted L2 | `prisma/seed.ts --data-only`: deterministic restaurant fixtures without auth users | target ownership checked and all migrations applied before tests | unit + DB integration tests |
| **dev** | Supabase project `fitsy-dev` with its own auth (JWKS), service role, and `DEMO_REVIEW_EMAILS=seed-pro@fitsy.dev` | seed + `scripts/dev/snapshot.ts` (~500 real LA restaurants, no user data); `scripts/dev/reset.ts` restores user tables nightly | `scripts/dev/vercel-build.sh` runs `prisma migrate deploy` on every **preview** build | Vercel previews, the stable dev API, local dev, simulator E2E, bug-repro routines |
| **prod** | project `zaxkmjqozvmbifiwbxps` | real | migrated by the deploy workflow before Vercel promotes (autonomous-shipping L8; until that lands, by hand: `prisma migrate deploy`) | production, post-deploy smoke only |

## Wiring

- **Vercel env**: `Preview` and `Development` environments hold the dev credentials; `Production` holds prod. `scripts/dev/provision-supabase.sh` writes them. Nothing in the repo references a dev secret.
- **Stable dev API**: `.github/workflows/mirror-dev-branch.yml` force-pushes `main` to a `dev` branch on every merge and fires a Vercel deploy hook (git pushes of an already-deployed SHA are deduped). Vercel builds it against the dev DB and serves it at `https://dev.fitsy.org`, a custom domain bound to the `dev` branch. Vercel Deployment Protection (SSO) is **off** for this project's previews (decided 2026-08-29): the branch-bound custom domain was still SSO-gated, and the mobile dev client cannot send a bypass header without a code change. Previews run against dev data and the API enforces its own auth, so the exposure is dev-only. If protection is ever wanted back, use a Protection Bypass for Automation secret and add the `x-vercel-protection-bypass` header to `apps/mobile/lib/api.ts` in dev builds.
- **Local API**: `npm run dev:env` pulls the Development env into `apps/api/.env.local`, so `npm run dev:api` talks to dev by default. Pointing local at prod is explicit: `vercel env pull --environment=production .env.prod.local` and load it yourself.
- **PR simulator validation**: Keep `dev.fitsy.org` pinned to `dev`; configure `EXPO_PUBLIC_API_URL` to the PR's Ready `fitsy-api` preview when its backend differs from main.
  Carry that same origin into Metro, Maestro and every fixture; the native runner verifies deployment/source identity and rejects production.
- **Mobile**: `npm run dev:env` also writes `apps/mobile/.env.development.local` (`EXPO_PUBLIC_API_URL` = stable dev API, dev Supabase URL and anon key). Expo reads it ahead of `.env` in dev mode; release builds keep the production `.env`.
  Local dotenv files do not sync to EAS automatically; use the explicit-source uploader below.
- **Scripts**: `set -a; source .env.dev; set +a` loads the dev set for `scripts/dev/*` and `scripts/verify/dev-drift.sh`.

## EAS public configuration

Use `scripts/sync-eas-env.py` for EAS public configuration uploads.
It requires one source file and one target, defaults to a dry run, and never merges other dotenv files or shell public values.
Review the variable-name plan before repeating the command with `--apply` under the existing release authorization.
There are no automated callers; do not replace this validation with direct `eas env:push` or `eas env:create` commands.

```bash
# Read-only validation and plan; also accepts --dry-run explicitly.
python3 scripts/sync-eas-env.py --source apps/mobile/.env.development.local --env development
# Preview is a separate explicit operation using a DEV source.
python3 scripts/sync-eas-env.py --source apps/mobile/.env.development.local --env preview
# Under existing authorization, upload only that source to that target.
python3 scripts/sync-eas-env.py --source apps/mobile/.env.development.local --env preview --apply
# Production requires a separately prepared, gitignored production source.
python3 scripts/sync-eas-env.py --source apps/mobile/.env.production.local --env production
```

Development and preview require `EXPO_PUBLIC_API_URL=https://dev.fitsy.org` and the DEV Supabase project `kegycybiruksmrzvniha`.
Production requires the API project's `https://fitsy-api.vercel.app` origin and the PROD Supabase project `zaxkmjqozvmbifiwbxps`.
The `fitsy.org` marketing site is rejected as an API source; see the [production deployment contract](production-deployment.md#constraints).
This uploader configures stable EAS environments; PR-specific simulator backend selection remains in the existing native runner and does not change the stable dev domain.
Every source must include `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in addition to the API URL.
Production also requires `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_POSTHOG_API_KEY`, matching the production bundle guard.

The uploader accepts only those fields plus the optional RevenueCat Android/Test Store keys, PostHog ingestion host, and Google iOS/Web client IDs already consumed by the app.
It validates public key types: Supabase `sb_publishable_` or matching-project `anon` JWT, RevenueCat `appl_`/`goog_`/`test_`, PostHog `phc_`, and Google OAuth client IDs.
PostHog hosts are limited to the US/EU HTTPS ingestion origins.
Empty, duplicate, malformed, interpolated and unapproved public fields fail closed before EAS starts.
Backend variables in a mixed source are excluded from the upload snapshot.
Login credentials, including `EXPO_PUBLIC_DEV_LOGIN_EMAIL` and `EXPO_PUBLIC_DEV_LOGIN_PASSWORD`, belong in local fixture preparation and are rejected for every EAS target.
Production also rejects RevenueCat Test Store keys; TestFlight and App Review sandbox purchases continue using the real platform SDK key.

Both dry run and apply verify the Supabase key against the selected project's read-only Auth settings endpoint over HTTPS without redirects or ambient proxies.
An unavailable provider or a key/project mismatch prevents every EAS mutation, including for opaque publishable keys.
Plans and errors contain names only; EAS receives a temporary, mode-600 validated snapshot through [the file-based env:push command](https://docs.expo.dev/eas/cli/#eas-envpush-environment) instead of values in command arguments, and its output is discarded.
The snapshot is removed after success or failure.
An upload failure can leave remote state uncertain; reconcile the selected target privately before retrying, without saving value-bearing CLI output in task logs.
No new deploy environment variables are required.

## Guardrails

- DEV-only scripts refuse production unconditionally through the shared [database target guard](db-guardrails.md).
- `snapshot.ts` opens prod with `default_transaction_read_only=on`; it cannot write there.
- `vercel-build.sh` refuses to migrate when a preview build sees the prod URL.
- The same entrypoint validates shared Redis configuration before migrations or builds; set the dedicated nonproduction `UPSTASH_REDIS_REST_URL` and writable `UPSTASH_REDIS_REST_TOKEN` in Preview before redeploying.
- `scripts/verify/dev-drift.sh` fails when dev lacks a migration on `main` or the seed floor is missing. Registered in `scripts/verify/registry.yml` as shadow; scheduled once the local runner exists.

## Auth in dev

Seed users are email/password accounts created through the dev project's admin API; `POST /api/auth/register` and `/login` work unchanged.
Production rejects legacy registration and restricts password login to the demo reviewer account on the server.
`ALLOW_STUB_SUBSCRIPTIONS` and additional `DEMO_REVIEW_EMAILS` apply only outside production.
Production RevenueCat reads reject Test Store keys but accept active platform-store sandbox purchases for TestFlight and App Review, logging `revenuecat.sandbox_entitlement_accepted` with only the user ID.
Webhook grants still require the `pro` entitlement and production environment.
Apple and Google sign-in are not configured in the dev project; enable them in the dev dashboard only if a flow under test needs them.

## Operations

| Task | Command |
|---|---|
| Provision (once) | `npx supabase login` then `bash scripts/dev/provision-supabase.sh` |
| Refresh local env files | `npm run dev:env` |
| Reset user data | `npm run dev:reset` |
| Refresh restaurant subset from prod | `PROD_DATABASE_URL=... npm run dev:snapshot` |
| Check drift | `npm run verify:dev-drift` |
| Rehearse a destructive migration at prod scale | still an on-demand Supabase branch of prod; dev is a subset |

Known limit: two open PRs with conflicting migrations share one dev schema.
The ephemeral container proves each migration applies cleanly; the collision only matters for preview URLs and is rare at current volume.
If it starts to bite, move to Supabase per-PR branching with the same scripts.
