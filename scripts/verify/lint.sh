#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
if npm run lint --workspaces --if-present >&2; then
  printf '{"name":"lint","status":"pass","summary":"eslint clean","fix":""}\n'
else
  printf '{"name":"lint","status":"fail","summary":"eslint errors","fix":"run: npm run lint --workspaces --if-present; fix errors it lists (npx eslint --fix for the mechanical ones)"}\n'
  exit 1
fi
