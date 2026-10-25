#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
FAILED=""
for ws in apps/api apps/mobile packages/shared scripts; do
  [ -f "$ws/tsconfig.json" ] || continue
  echo "--- type-check $ws" >&2
  # Workspace scripts own prerequisites, including the API's Prisma generation.
  (cd "$ws" && npm run --silent type-check) >&2 || FAILED="$FAILED $ws"
done
if [ -n "$FAILED" ]; then
  printf '{"name":"typecheck","status":"fail","summary":"type-check failed in:%s","fix":"cd into the failing workspace and run npm run type-check; fix the listed generation or type errors"}\n' "$FAILED"
  exit 1
fi
printf '{"name":"typecheck","status":"pass","summary":"type-check clean in all workspaces","fix":""}\n'
