#!/usr/bin/env bash
# Architecture boundaries as code (T3): .dependency-cruiser.cjs.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
if npx depcruise apps/api/app apps/api/lib apps/api/services apps/mobile/app apps/mobile/components apps/mobile/lib packages/shared/src scripts --config .dependency-cruiser.cjs >&2; then
  printf '{"name":"boundaries","status":"pass","summary":"no dependency violations","fix":""}\n'
else
  printf '{"name":"boundaries","status":"fail","summary":"import crosses a layer boundary","fix":"each violation names the rule; the allowed graph is documented at the top of .dependency-cruiser.cjs — move the code or call through the permitted layer"}\n'
  exit 1
fi
