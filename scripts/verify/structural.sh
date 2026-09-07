#!/usr/bin/env bash
# Wraps scripts/structural-tests.sh under the check contract.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(bash "$REPO_ROOT/scripts/structural-tests.sh" 2>&1)"; CODE=$?
echo "$OUT" >&2
if [ $CODE -eq 0 ]; then
  printf '{"name":"structural","status":"pass","summary":"all structural tests passed","fix":""}\n'
else
  FIRST="$(echo "$OUT" | grep -B0 "FAIL" | head -1 | tr '"' "'")"
  printf '{"name":"structural","status":"fail","summary":"%s","fix":"read the failing test output above; each test names the file and the expected invariant"}\n' "$FIRST"
fi
exit $CODE
