# scripts/dev

Tooling for the **dev environment**: a second Supabase project (`fitsy-dev`) that Vercel previews, local dev, and simulator E2E use instead of production.
Design: `docs/engineering/devops/staging-environment.md`.

Every DEV writer refuses production unconditionally through the [shared database guard](../../docs/engineering/devops/db-guardrails.md).
The retired `FITSY_ALLOW_PROD=1` override has no effect.

| Script | What it does | When |
|---|---|---|
| `provision-supabase.sh` | validate the allowlisted existing DEV target before credential lookup or Vercel Preview/Development updates, then migrate, seed, snapshot | once |
| `provision-audit-role.ts` | create the DEV-only SELECT role and privately save credential names | once, with `--apply` |
| `audit-readonly.ts` | verify saved DEV audit access and optional zero-row write denials | after audit provisioning |
| `write-local-env.sh` | pull dev creds into `apps/api/.env.local`, `.env.dev`, `apps/mobile/.env.development.local` | after provisioning; whenever creds rotate |
| `../../prisma/seed.ts` (`npx prisma db seed`) | deterministic fixture: 3 users, 50 restaurants, 400 items | on a fresh DB; safe to re-run |
| `snapshot.ts` | copy ~500 real LA restaurants (no user data) from prod read-only into dev | monthly, or when search needs fresher data |
| `reset.ts` | reset user data to seed state (admin mode with a service key; sql-only mode otherwise preserves seed auth users) | nightly (CI, sql-only); before E2E |
| `vercel-build.sh` | Vercel build entrypoint; validates database targets, required environment bindings and Redis readiness in every deployment environment, holds unapproved production role SQL, and skips activation for validated legacy bindings pending provisioning | every Vercel build |
| `../verify/dev-drift.sh` | dev has every migration on `main` and seed data present | scheduled + before E2E |

Automatic Supabase project creation is retired.
A replacement project requires a reviewed DEV-reference update before wiring.

## Env

Scripts read `POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` from the shell.
Load the dev set with:

```bash
set -a; source .env.dev; set +a          # produced by write-local-env.sh
```

`snapshot.ts` additionally needs `PROD_DATABASE_URL` (prod `POSTGRES_URL_NON_POOLING`, pulled with `vercel env pull --environment=production`).

Refreshing local files does not update EAS.
Use the [explicit-source EAS uploader](../../docs/engineering/devops/staging-environment.md#eas-public-configuration) with one DEV target, review its dry run, and apply only under existing authorization.
Keep fixture login credentials local; the uploader rejects them.

## Seed accounts

| Email | Password | Role |
|---|---|---|
| `seed-pro@fitsy.dev` | `fitsy-seed-pass-2026` | entitled via `DEMO_REVIEW_EMAILS` in the dev env |
| `seed-free@fitsy.dev` | same | no subscription; hits the 402 gate |
| `seed-new@fitsy.dev` | same | onboarding not started |
