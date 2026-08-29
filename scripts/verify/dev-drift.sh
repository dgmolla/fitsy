#!/usr/bin/env bash
# Check: the dev environment matches main's schema and holds seed data.
#
# Contract (scripts/verify/README.md): exit 0 pass, 1 fail, 2 skipped;
# one JSON line on stdout with name/status/summary/fix.
#
# Env: POSTGRES_URL_NON_POOLING (dev). Skips (exit 2) when unset so the check
# is harmless in contexts without dev credentials.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="dev-drift"

emit() { # status summary fix
  printf '{"name":"%s","status":"%s","summary":"%s","fix":"%s"}\n' "$NAME" "$1" "$2" "$3"
}

URL="${POSTGRES_URL_NON_POOLING:-}"
if [ -z "$URL" ]; then
  emit skipped "POSTGRES_URL_NON_POOLING not set" "vercel env pull --environment=preview .env.dev"
  exit 2
fi
if [[ "$URL" == *zaxkmjqozvmbifiwbxps* ]]; then
  emit fail "POSTGRES_URL_NON_POOLING points at production" "point it at the fitsy-dev project (vercel env pull --environment=preview)"
  exit 1
fi
if ! command -v psql >/dev/null; then
  emit skipped "psql not installed" "brew install libpq && brew link --force libpq"
  exit 2
fi

Q() { psql "$URL" -Atqc "$1"; }

# 1. Migrations applied in dev vs migrations on disk.
applied="$(Q "select migration_name from _prisma_migrations where finished_at is not null order by 1" || true)"
expected="$(ls "$REPO_ROOT/prisma/migrations" | grep -v migration_lock.toml | sort)"
missing="$(comm -23 <(echo "$expected") <(echo "$applied") | tr '\n' ' ')"
if [ -n "$missing" ]; then
  emit fail "dev is missing migrations: ${missing}" "POSTGRES_URL_NON_POOLING=<dev> npx prisma migrate deploy --schema prisma/schema.prisma"
  exit 1
fi

# 2. Seed data present.
r="$(Q 'select count(*) from "Restaurant"')"
m="$(Q 'select count(*) from "MenuItem"')"
e="$(Q 'select count(*) from "MacroEstimate"')"
u="$(Q 'select count(*) from "User" where email like '"'"'seed-%@fitsy.dev'"'"'')"
if [ "$r" -lt 50 ] || [ "$m" -lt 400 ] || [ "$e" -lt 400 ]; then
  emit fail "dev data below seed floor (restaurants=$r items=$m estimates=$e)" "npx prisma db seed  (then scripts/dev/snapshot.ts for real-shaped data)"
  exit 1
fi
if [ "$u" -lt 3 ]; then
  emit fail "seed users missing (found $u of 3)" "npx tsx scripts/dev/reset.ts"
  exit 1
fi

emit pass "dev in sync: ${#expected} migrations, restaurants=$r items=$m estimates=$e seedUsers=$u" ""
exit 0
