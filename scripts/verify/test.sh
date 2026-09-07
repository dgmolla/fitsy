#!/usr/bin/env bash
# api unit tests with coverage gate + scripts and mobile tests. CI provides the Postgres service container env; locally all tests
# mock external services so no DB is required.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
FAIL=""
npm run test:coverage --workspace=apps/api >&2 || FAIL="apps/api"
npm test --workspace=@fitsy/scripts >&2 || FAIL="${FAIL:+$FAIL, }scripts"
npm test --workspace=@fitsy/mobile >&2 || FAIL="${FAIL:+$FAIL, }mobile"
if [ -n "$FAIL" ]; then
  printf '{"name":"test","status":"fail","summary":"tests failed in: %s","fix":"run the failing workspace suite locally (npm run test:coverage -w apps/api or npm test -w @fitsy/scripts) and fix"}\n' "$FAIL"
  exit 1
fi
printf '{"name":"test","status":"pass","summary":"api coverage gate + scripts tests green","fix":""}\n'
