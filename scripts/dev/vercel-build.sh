#!/usr/bin/env bash
# Vercel build entrypoint (vercel.json buildCommand).
#
# The existing Git integration applies additive migrations before building.
# A failed migration withholds the build and Vercel's production promotion.
set -euo pipefail
if [ "${VERCEL_ENV:-}" = "production" ]; then
  bash scripts/deploy/migrate-prod.sh
else
  # Development/preview bindings must never contain either production URL.
  case "${POSTGRES_URL_NON_POOLING:-} ${POSTGRES_PRISMA_URL:-}" in
    *zaxkmjqozvmbifiwbxps*) echo "refusing: nonproduction build points at PRODUCTION" >&2; exit 1 ;;
  esac
fi
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  case "${POSTGRES_URL_NON_POOLING:-}" in
    "") echo "preview build: POSTGRES_URL_NON_POOLING unset, skipping migrate" >&2 ;;
    *) echo "preview build: prisma migrate deploy -> dev" >&2
       npx prisma migrate deploy --schema prisma/schema.prisma ;;
  esac
fi
npm run build -w apps/api
