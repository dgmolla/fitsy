#!/usr/bin/env bash
# Vercel build entrypoint (vercel.json buildCommand).
#
# The existing Git integration applies additive migrations before building.
# A failed migration withholds the build and Vercel's production promotion.
set -euo pipefail
# A database-only health response cannot establish auth/data readiness.
# Validate the same required Redis configuration as requests before any writes.
node --import tsx apps/api/services/rateLimitStoreConfig.ts
if [ "${VERCEL_ENV:-}" = "production" ]; then
  bash scripts/deploy/migrate-prod.sh
else
  node --import tsx scripts/lib/db-target-guard.ts --dev-only \
    --env=POSTGRES_URL_NON_POOLING --env=POSTGRES_PRISMA_URL
fi
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  case "${POSTGRES_URL_NON_POOLING:-}" in
    "") echo "preview build: POSTGRES_URL_NON_POOLING unset, skipping migrate" >&2 ;;
    *) echo "preview build: prisma migrate deploy -> dev" >&2
       npx prisma migrate deploy --schema prisma/schema.prisma ;;
  esac
fi
npm run build -w apps/api
