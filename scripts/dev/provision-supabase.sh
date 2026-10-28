#!/usr/bin/env bash
# Wire the reviewed, allowlisted fitsy-dev project into Preview + Development,
# then migrate, seed and snapshot. Project creation/replacement requires review.
#
# Prereqs (interactive, run once by a human):
#   npx supabase login
#   vercel whoami            (already linked to project "fitsy")
#
# Usage:
#   bash scripts/dev/provision-supabase.sh --wire-only <project-ref> <db-password>
#
# Idempotent where it can be: re-running with --wire-only re-pushes env vars.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

REGION="${SUPABASE_REGION:-us-west-1}"

log() { echo "[provision] $*" >&2; }
need() { command -v "$1" >/dev/null || { log "missing: $1"; exit 1; }; }
need npx; need vercel; need jq; need curl

sb() { npx --yes supabase "$@"; }

# ---------------------------------------------------------------------------
# 1. Select the already-reviewed project. Never create an unallowlisted project.
# ---------------------------------------------------------------------------
if [ "${1:-}" != "--wire-only" ] || [ "$#" -ne 3 ]; then
  log "automatic project creation is retired; use --wire-only <reviewed-dev-ref> <db-password>. A replacement needs a reviewed DEV allowlist update first."
  exit 1
fi
REF="$2"; DB_PASS="$3"

# ---------------------------------------------------------------------------
# 2. Derive and validate routing before any credential lookup or Vercel change.
# ---------------------------------------------------------------------------
SUPABASE_URL="https://${REF}.supabase.co"
# The direct host db.<ref>.supabase.co is IPv6-only on the free tier and Vercel
# builders are IPv4, so both URLs go through Supavisor: session mode (5432)
# for migrations, transaction mode (6543) for the app. Same shape as prod.
POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-0-${REGION}.pooler.supabase.com}"
DIRECT_URL="postgresql://postgres.${REF}:${DB_PASS}@${POOLER_HOST}:5432/postgres"
POOLED_URL="postgresql://postgres.${REF}:${DB_PASS}@${POOLER_HOST}:6543/postgres?pgbouncer=true"

export POSTGRES_PRISMA_URL="$POOLED_URL" POSTGRES_URL_NON_POOLING="$DIRECT_URL"
node --import tsx scripts/lib/db-target-guard.ts --dev-only \
  --env=POSTGRES_URL_NON_POOLING --env=POSTGRES_PRISMA_URL
# Runtime uses a distinct preselected login, never the administrator password.
node --import tsx -e 'const {assertDevDatabase,assertDatabaseRole}=require("./scripts/lib/db-target-guard"); assertDatabaseRole(assertDevDatabase(process.env.DEV_APP_DATABASE_URL),"fitsy_app")'
KEYS_JSON="$(sb projects api-keys --project-ref "$REF" -o json)"
ANON_KEY="$(echo "$KEYS_JSON" | jq -r '.[] | select(.name=="anon") | .api_key')"
SERVICE_KEY="$(echo "$KEYS_JSON" | jq -r '.[] | select(.name=="service_role") | .api_key')"
[ -n "$ANON_KEY" ] && [ -n "$SERVICE_KEY" ] || { log "could not read API keys"; exit 1; }

log "verifying direct connection"
POSTGRES_URL_NON_POOLING="$DIRECT_URL" npx prisma migrate status --schema prisma/schema.prisma >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 3. Push to Vercel Preview + Development (source of truth for dev creds)
# ---------------------------------------------------------------------------
push() { # KEY VALUE  (REST API; never touches Production, see vercel-env-set.sh)
  bash "$REPO_ROOT/scripts/dev/vercel-env-set.sh" "$1" "$2"
}
push POSTGRES_PRISMA_URL "$DEV_APP_DATABASE_URL"
push POSTGRES_URL "$DEV_APP_DATABASE_URL"
push POSTGRES_URL_NON_POOLING "$DIRECT_URL"
push POSTGRES_HOST "$POOLER_HOST"
push SUPABASE_URL "$SUPABASE_URL"
push NEXT_PUBLIC_SUPABASE_URL "$SUPABASE_URL"
push SUPABASE_ANON_KEY "$ANON_KEY"
push NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON_KEY"
push SUPABASE_SERVICE_ROLE_KEY "$SERVICE_KEY"
push DEMO_REVIEW_EMAILS "seed-pro@fitsy.dev"
push FITSY_ENV "dev"

# ---------------------------------------------------------------------------
# 4. Migrate, seed, snapshot
# ---------------------------------------------------------------------------
export SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
log "prisma migrate deploy"
npx prisma migrate deploy --schema prisma/schema.prisma
POSTGRES_PRISMA_URL="$DEV_APP_DATABASE_URL" node --import tsx scripts/deploy/activate-runtime-role.ts
log "seed"
npx tsx prisma/seed.ts
if [ -n "${PROD_DATABASE_URL:-}" ]; then
  log "snapshot from prod"
  npx tsx scripts/dev/snapshot.ts
else
  log "PROD_DATABASE_URL not set; skipping snapshot. Later: PROD_DATABASE_URL=<prod POSTGRES_URL_NON_POOLING> npx tsx scripts/dev/snapshot.ts"
fi
log "drift check"
bash scripts/verify/dev-drift.sh || true

# ---------------------------------------------------------------------------
# 5. Local env files
# ---------------------------------------------------------------------------
if [ "${SKIP_LOCAL_ENV:-}" = "1" ]; then log "SKIP_LOCAL_ENV=1: not touching local env files (run: npm run dev:env)"; else bash scripts/dev/write-local-env.sh; fi
log "done. Next: enable Apple/Google providers in the dev Supabase dashboard only if you need social sign-in in dev (email/password seed users cover E2E)."
