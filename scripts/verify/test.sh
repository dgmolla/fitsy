#!/usr/bin/env bash
# API coverage plus scripts and mobile tests. With a DB configured, serialize the
# whole API run: shared-schema suites can exhaust each other's SERIALIZABLE retry
# budget. Explicit concurrency inside a test remains unchanged.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
FAIL=""
if [ -n "${POSTGRES_PRISMA_URL:-}" ]; then
  npm run test:coverage --workspace=apps/api -- --runInBand >&2 || FAIL="apps/api"
else
  npm run test:coverage --workspace=apps/api >&2 || FAIL="apps/api"
fi
# Real decoder and attachment cases run in the required local media lane;
# their deterministic contract cases remain registered here.
FITSY_MEDIA_INTEGRATION=0 npm test --workspace=@fitsy/scripts -- --runInBand >&2 || FAIL="${FAIL:+$FAIL, }scripts"
npm test --workspace=@fitsy/mobile -- --runInBand >&2 || FAIL="${FAIL:+$FAIL, }mobile"
if [ -n "$FAIL" ]; then
  printf '{"name":"test","status":"fail","summary":"tests failed in: %s","fix":"run the failing workspace suite locally (npm run test:coverage -w apps/api or npm test -w @fitsy/scripts) and fix"}\n' "$FAIL"
  exit 1
fi
printf '{"name":"test","status":"pass","summary":"api coverage gate + scripts tests green","fix":""}\n'
