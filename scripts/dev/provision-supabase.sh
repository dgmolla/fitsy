#!/usr/bin/env bash
# One-time: create the fitsy-dev Supabase project and wire it into Vercel's
# Preview + Development environments, then migrate, seed, and snapshot.
#
# Prereqs (interactive, run once by a human):
#   npx supabase login
#   vercel whoami            (already linked to project "fitsy")
#
# Usage:
#   bash scripts/dev/provision-supabase.sh            # create + wire + migrate + seed
#   bash scripts/dev/provision-supabase.sh --wire-only <project-ref> <db-password>
#
# Idempotent where it can be: re-running with --wire-only re-pushes env vars.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

PROJECT_NAME="fitsy-dev"
REGION="${SUPABASE_REGION:-us-west-1}"
PROD_REF="zaxkmjqozvmbifiwbxps"

log() { echo "[provision] $*" >&2; }
need() { command -v "$1" >/dev/null || { log "missing: $1"; exit 1; }; }
need npx; need vercel; need jq; need curl

sb() { npx --yes supabase "$@"; }

# ---------------------------------------------------------------------------
# 1. Create (or locate) the project
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--wire-only" ]; then
  REF="${2:?project ref}"; DB_PASS="${3:?db password}"
else
  log "checking Supabase CLI auth"
  if ! sb projects list -o json >/tmp/sb-projects.json 2>/dev/null; then
    log "Supabase CLI is not logged in. Run:  npx supabase login   then re-run this script."
    exit 1
  fi
  REF="$(jq -r --arg n "$PROJECT_NAME" '.[] | select(.name==$n) | .id' /tmp/sb-projects.json | head -1)"
  if [ -n "$REF" ]; then
    log "project $PROJECT_NAME already exists ($REF). Need its DB password to wire; re-run with --wire-only $REF <password>."
    exit 1
  fi
  ORG_ID="${SUPABASE_ORG_ID:-$(sb orgs list -o json | jq -r '.[0].id')}"
  DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)"
  log "creating $PROJECT_NAME in org $ORG_ID region $REGION"
  sb projects create "$PROJECT_NAME" --org-id "$ORG_ID" --region "$REGION" --db-password "$DB_PASS" -o json >/tmp/sb-create.json
  REF="$(jq -r '.id' /tmp/sb-create.json)"
  log "created $REF. Waiting for ACTIVE_HEALTHY..."
  for _ in $(seq 1 60); do
    STATUS="$(sb projects list -o json | jq -r --arg r "$REF" '.[] | select(.id==$r) | .status')"
    [ "$STATUS" = "ACTIVE_HEALTHY" ] && break
    sleep 10
  done
  [ "$STATUS" = "ACTIVE_HEALTHY" ] || { log "project not healthy after 10 min (status=$STATUS)"; exit 1; }
  log "DB password (store in your password manager, it is not retrievable later): $DB_PASS"
fi

[ "$REF" != "$PROD_REF" ] || { log "refusing to wire the PRODUCTION project as dev"; exit 1; }

# ---------------------------------------------------------------------------
# 2. Derive connection strings + keys
# ---------------------------------------------------------------------------
KEYS_JSON="$(sb projects api-keys --project-ref "$REF" -o json)"
ANON_KEY="$(echo "$KEYS_JSON" | jq -r '.[] | select(.name=="anon") | .api_key')"
SERVICE_KEY="$(echo "$KEYS_JSON" | jq -r '.[] | select(.name=="service_role") | .api_key')"
[ -n "$ANON_KEY" ] && [ -n "$SERVICE_KEY" ] || { log "could not read API keys"; exit 1; }

SUPABASE_URL="https://${REF}.supabase.co"
DIRECT_URL="postgresql://postgres:${DB_PASS}@db.${REF}.supabase.co:5432/postgres"
POOLED_URL="postgresql://postgres.${REF}:${DB_PASS}@aws-0-${REGION}.pooler.supabase.com:6543/postgres?pgbouncer=true"

log "verifying direct connection"
POSTGRES_URL_NON_POOLING="$DIRECT_URL" npx prisma migrate status --schema prisma/schema.prisma >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 3. Push to Vercel Preview + Development (source of truth for dev creds)
# ---------------------------------------------------------------------------
push() { # KEY VALUE  (REST API; never touches Production, see vercel-env-set.sh)
  bash "$REPO_ROOT/scripts/dev/vercel-env-set.sh" "$1" "$2"
}
push POSTGRES_PRISMA_URL "$POOLED_URL"
push POSTGRES_URL "$POOLED_URL"
push POSTGRES_URL_NON_POOLING "$DIRECT_URL"
push POSTGRES_HOST "db.${REF}.supabase.co"
push POSTGRES_PASSWORD "$DB_PASS"
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
export POSTGRES_PRISMA_URL="$POOLED_URL" POSTGRES_URL_NON_POOLING="$DIRECT_URL" \
       SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
log "prisma migrate deploy"
npx prisma migrate deploy --schema prisma/schema.prisma
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
