# scripts/dev

Tooling for the **dev environment**: a second Supabase project (`fitsy-dev`) that Vercel previews, local dev, and simulator E2E use instead of production.
Design: `docs/engineering/devops/staging-environment.md`.

Every script refuses to target production (`lib/guard.ts`); override only with `FITSY_ALLOW_PROD=1`.

| Script | What it does | When |
|---|---|---|
| `provision-supabase.sh` | create `fitsy-dev`, push its creds to Vercel Preview + Development, migrate, seed, snapshot | once |
| `write-local-env.sh` | pull dev creds into `apps/api/.env.local`, `.env.dev`, `apps/mobile/.env.development.local` | after provisioning; whenever creds rotate |
| `../../prisma/seed.ts` (`npx prisma db seed`) | deterministic fixture: 3 users, 50 restaurants, 400 items | on a fresh DB; safe to re-run |
| `snapshot.ts` | copy ~500 real LA restaurants (no user data) from prod read-only into dev | monthly, or when search needs fresher data |
| `reset.ts` | delete all dev auth users, truncate user tables, re-seed users | nightly; before E2E |
| `vercel-build.sh` | Vercel build entrypoint; migrates dev on preview builds | every Vercel build |
| `../verify/dev-drift.sh` | dev has every migration on `main` and seed data present | scheduled + before E2E |

## Env

Scripts read `POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` from the shell.
Load the dev set with:

```bash
set -a; source .env.dev; set +a          # produced by write-local-env.sh
```

`snapshot.ts` additionally needs `PROD_DATABASE_URL` (prod `POSTGRES_URL_NON_POOLING`, pulled with `vercel env pull --environment=production`).

## Seed accounts

| Email | Password | Role |
|---|---|---|
| `seed-pro@fitsy.dev` | `fitsy-seed-pass-2026` | entitled via `DEMO_REVIEW_EMAILS` in the dev env |
| `seed-free@fitsy.dev` | same | no subscription; hits the 402 gate |
| `seed-new@fitsy.dev` | same | onboarding not started |
