#!/usr/bin/env bash
# Vercel build entrypoint (vercel.json buildCommand).
#
# The existing Git integration applies additive migrations before building.
# A failed migration withholds the build and Vercel's production promotion.
set -euo pipefail
if [ "${VERCEL_ENV:-}" = "production" ]; then
  bash scripts/deploy/migrate-prod.sh
else
  node --import tsx scripts/lib/db-target-guard.ts --dev-only \
    --env=POSTGRES_URL_NON_POOLING --env=POSTGRES_PRISMA_URL
fi
if [ "${VERCEL_ENV:-}" != "production" ]; then
  node --import tsx scripts/deploy/rate-limit-preflight.ts
fi
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  case "${POSTGRES_URL_NON_POOLING:-}" in
    "") echo "preview build: POSTGRES_URL_NON_POOLING unset, skipping migrate" >&2 ;;
    *) echo "preview build: prisma migrate deploy -> dev" >&2
       npx prisma migrate deploy --schema prisma/schema.prisma
       node --import tsx scripts/deploy/activate-runtime-role.ts ;;
  esac
fi
npm run build -w apps/api
