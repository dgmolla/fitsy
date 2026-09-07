#!/usr/bin/env bash
# T9: migrations in this branch must be additive, or ship a down.sql.
# Extends structural check 13 (NOT NULL without default) with the destructive
# classes: DROP TABLE/COLUMN, column type changes, TRUNCATE.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
git rev-parse origin/main >/dev/null 2>&1 || { printf '{"name":"migration-safety","status":"fail","summary":"origin/main unresolvable; cannot audit migrations","fix":"git fetch origin main and re-run"}\n'; exit 1; }
CHANGED="$(git diff --name-only origin/main...HEAD -- 'prisma/migrations/**/migration.sql' 2>/dev/null || true)"
if [ -z "$CHANGED" ]; then
  printf '{"name":"migration-safety","status":"skipped","summary":"no new migrations in branch","fix":""}\n'
  exit 2
fi
# space around TYPE avoids matching column names that merely end in "type"
DESTRUCTIVE_RE='DROP TABLE|DROP COLUMN|TRUNCATE|RENAME TO|RENAME COLUMN|SET DATA TYPE|ALTER COLUMN [^;]* TYPE '
BAD=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  DIR="$(dirname "$f")"
  # keyword scan, no line anchors: Prisma wraps ALTER statements across lines
  # collapse whitespace so statements split across lines still match
  if tr '\n' ' ' < "$f" | grep -qiE "$DESTRUCTIVE_RE"; then
    if [ ! -f "$DIR/down.sql" ]; then
      BAD="$BAD ${DIR#prisma/migrations/}"
      tr '\n' ' ' < "$f" | grep -oiE "$DESTRUCTIVE_RE" | head -3 >&2
    fi
  fi
done <<< "$CHANGED"
if [ -n "$BAD" ]; then
  printf '{"name":"migration-safety","status":"fail","summary":"destructive migration without down.sql:%s","fix":"either make the migration additive (expand-migrate-contract), or add a tested down.sql next to migration.sql"}\n' "$BAD"
  exit 1
fi
printf '{"name":"migration-safety","status":"pass","summary":"new migrations are additive or carry down.sql","fix":""}\n'
