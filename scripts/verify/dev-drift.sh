#!/usr/bin/env bash
# Check: the dev environment matches main's schema and holds seed data.
#
# Contract (scripts/verify/README.md): exit 0 pass, 1 fail, 2 skipped;
# one JSON line on stdout with name/status/summary/fix.
#
# Env: POSTGRES_URL_NON_POOLING (dev). Local checks can skip missing setup;
# CI and scheduled checks require an actual pass.
set -euo pipefail
# Sort both inputs locally; pin C defensively so host locale changes cannot alter ordering.
export LC_ALL=C
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="dev-drift"

emit() { # status summary fix
  printf '{"name":"%s","status":"%s","summary":"%s","fix":"%s"}\n' "$NAME" "$1" "$2" "$3"
}
unavailable() { # summary fix
  if [ "${CI:-}" = true ] || [ "${FITSY_RUNS:-}" = ci ] || [ "${FITSY_RUNS:-}" = scheduled ]; then
    emit fail "$1" "$2"
    exit 1
  fi
  emit skipped "$1" "$2"
  exit 2
}

URL="${POSTGRES_URL_NON_POOLING:-}"
if [ -z "$URL" ]; then
  unavailable "POSTGRES_URL_NON_POOLING not set" "vercel env pull --environment=preview .env.dev"
fi
if [[ "$URL" == *zaxkmjqozvmbifiwbxps* ]]; then
  emit fail "POSTGRES_URL_NON_POOLING points at production" "point it at the fitsy-dev project (vercel env pull --environment=preview)"
  exit 1
fi
if ! command -v psql >/dev/null; then
  unavailable "psql not installed" "brew install libpq && brew link --force libpq"
fi

Q() { psql "$URL" -Atqc "$1"; }

# 1. Migrations applied in dev vs migrations on disk.
if ! applied="$(Q "select migration_name from _prisma_migrations where finished_at is not null")"; then
  emit fail "could not read dev migration history" "check the dev database connection and _prisma_migrations table"
  exit 1
fi
applied="$(printf '%s\n' "$applied" | sort -u)"
expected="$(ls "$REPO_ROOT/prisma/migrations" | grep -v migration_lock.toml | sort -u)"
missing="$(comm -23 <(printf '%s\n' "$expected") <(printf '%s\n' "$applied") | tr '\n' ' ')"
if [ -n "$missing" ]; then
  emit fail "dev is missing migrations: ${missing}" "POSTGRES_URL_NON_POOLING=<dev> npx prisma migrate deploy --schema prisma/schema.prisma"
  exit 1
fi

# 2. Seed data present.
if ! r="$(Q 'select count(*) from "Restaurant"')" \
  || ! m="$(Q 'select count(*) from "MenuItem"')" \
  || ! e="$(Q 'select count(*) from "MacroEstimate"')" \
  || ! u="$(Q 'select count(*) from "User" where email like '"'"'seed-%@fitsy.dev'"'"'')"; then
  emit fail "could not read dev seed counts" "check the dev database connection and seed tables"
  exit 1
fi
for count in "$r" "$m" "$e" "$u"; do
  case "$count" in
    ''|*[!0-9]*) emit fail "invalid dev seed count" "check the dev database connection and client output"; exit 1 ;;
  esac
done
if [ "$r" -lt 50 ] || [ "$m" -lt 400 ] || [ "$e" -lt 400 ]; then
  emit fail "dev data below seed floor (restaurants=$r items=$m estimates=$e)" "npx prisma db seed  (then scripts/dev/snapshot.ts for real-shaped data)"
  exit 1
fi
if [ "$u" -lt 3 ]; then
  emit fail "seed users missing (found $u of 3)" "npx tsx scripts/dev/reset.ts"
  exit 1
fi

migration_count="$(printf '%s\n' "$expected" | awk 'NF {n++} END {print n+0}')"
emit pass "dev in sync: $migration_count migrations, restaurants=$r items=$m estimates=$e seedUsers=$u" ""
exit 0
