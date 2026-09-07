#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
FAILED=""
for ws in apps/api apps/mobile packages/shared scripts; do
  [ -f "$ws/tsconfig.json" ] || continue
  echo "--- tsc $ws" >&2
  (cd "$ws" && npx tsc --noEmit) >&2 || FAILED="$FAILED $ws"
done
if [ -n "$FAILED" ]; then
  printf '{"name":"typecheck","status":"fail","summary":"tsc failed in:%s","fix":"cd into the failing workspace and run npx tsc --noEmit; fix the listed type errors"}\n' "$FAILED"
  exit 1
fi
printf '{"name":"typecheck","status":"pass","summary":"tsc clean in all workspaces","fix":""}\n'
