#!/usr/bin/env bash
# Apply pending Prisma migrations to PRODUCTION. Called by deploy.yml on push
# to main when prisma/migrations changed; runnable by hand with the same guard.
# Migrations must be additive (structural check 13 + migration review) so old
# code stays correct while Vercel builds.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
: "${PROD_DATABASE_URL:?PROD_DATABASE_URL required (prod POSTGRES_URL_NON_POOLING)}"
if [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "${FITSY_ALLOW_PROD:-}" != "1" ]; then
  echo "refusing outside CI without FITSY_ALLOW_PROD=1" >&2; exit 1
fi
export POSTGRES_URL_NON_POOLING="$PROD_DATABASE_URL" POSTGRES_PRISMA_URL="$PROD_DATABASE_URL"
npx prisma migrate status --schema prisma/schema.prisma || true
npx prisma migrate deploy --schema prisma/schema.prisma
