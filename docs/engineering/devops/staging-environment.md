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
        V[fitsy.org] --> PR
        PIPE[preload pipeline] --> PR
    end
    main[(push to main)] --> V
    main -. mirror-dev-branch.yml .-> DA
```

| Env | What | Data | Schema | Used by |
|---|---|---|---|---|
| **ephemeral** | Postgres/PostGIS container in CI (`ci.yml` service) or locally | `prisma/seed.ts` (`npx prisma db seed`): 50 restaurants in one LA ring, 400 items, 3 users | all migrations applied fresh each run | unit + DB integration tests |
| **dev** | Supabase project `fitsy-dev` with its own auth (JWKS), service role, and `DEMO_REVIEW_EMAILS=seed-pro@fitsy.dev` | seed + `scripts/dev/snapshot.ts` (~500 real LA restaurants, no user data); `scripts/dev/reset.ts` restores user tables nightly | `scripts/dev/vercel-build.sh` runs `prisma migrate deploy` on every **preview** build | Vercel previews, the stable dev API, local dev, simulator E2E, bug-repro routines |
| **prod** | project `zaxkmjqozvmbifiwbxps` | real | migrated by the deploy workflow before Vercel promotes (autonomous-shipping L8; until that lands, by hand: `prisma migrate deploy`) | production, post-deploy smoke only |

## Wiring

- **Vercel env**: `Preview` and `Development` environments hold the dev credentials; `Production` holds prod. `scripts/dev/provision-supabase.sh` writes them. Nothing in the repo references a dev secret.
- **Stable dev API**: `.github/workflows/mirror-dev-branch.yml` force-pushes `main` to a `dev` branch on every merge and fires a Vercel deploy hook (git pushes of an already-deployed SHA are deduped). Vercel builds it against the dev DB and serves it at `https://dev.fitsy.org`, a custom domain bound to the `dev` branch. Vercel Deployment Protection (SSO) is **off** for this project's previews (decided 2026-08-29): the branch-bound custom domain was still SSO-gated, and the mobile dev client cannot send a bypass header without a code change. Previews run against dev data and the API enforces its own auth, so the exposure is dev-only. If protection is ever wanted back, use a Protection Bypass for Automation secret and add the `x-vercel-protection-bypass` header to `apps/mobile/lib/api.ts` in dev builds.
- **Local API**: `npm run dev:env` pulls the Development env into `apps/api/.env.local`, so `npm run dev:api` talks to dev by default. Pointing local at prod is explicit: `vercel env pull --environment=production .env.prod.local` and load it yourself.
- **Mobile**: `npm run dev:env` also writes `apps/mobile/.env.development.local` (`EXPO_PUBLIC_API_URL` = stable dev API, dev Supabase URL and anon key). Expo reads it ahead of `.env` in dev mode; release builds keep the production `.env`.
- **Scripts**: `set -a; source .env.dev; set +a` loads the dev set for `scripts/dev/*` and `scripts/verify/dev-drift.sh`.

## Guardrails

- Every script in `scripts/dev/` refuses a URL containing the prod project ref unless `FITSY_ALLOW_PROD=1` (`scripts/dev/lib/guard.ts`).
- `snapshot.ts` opens prod with `default_transaction_read_only=on`; it cannot write there.
- `vercel-build.sh` refuses to migrate when a preview build sees the prod URL.
- `scripts/verify/dev-drift.sh` fails when dev lacks a migration on `main` or the seed floor is missing. Registered in `scripts/verify/registry.yml` as shadow; scheduled once the local runner exists.

## Auth in dev

Seed users are email/password accounts created through the dev project's admin API; `POST /api/auth/register` and `/login` work unchanged.
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
