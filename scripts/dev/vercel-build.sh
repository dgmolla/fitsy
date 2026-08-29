#!/usr/bin/env bash
# Vercel build entrypoint (vercel.json buildCommand).
#
# Preview builds apply the branch's Prisma migrations to the DEV database first,
# so every preview URL runs against its own schema. Production builds never
# migrate here: prod migrations belong to the deploy workflow (L8), which runs
# before Vercel promotes.
set -euo pipefail
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  case "${POSTGRES_URL_NON_POOLING:-}" in
    *zaxkmjqozvmbifiwbxps*) echo "refusing: preview build would migrate PRODUCTION" >&2; exit 1 ;;
    "") echo "preview build: POSTGRES_URL_NON_POOLING unset, skipping migrate" >&2 ;;
    *) echo "preview build: prisma migrate deploy -> dev" >&2
       npx prisma migrate deploy --schema prisma/schema.prisma ;;
  esac
fi
npm run build -w apps/api
