#!/usr/bin/env bash
# Real Redis Lua plus the same independent-worker journeys used by API tests.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
if FITSY_TEST_REAL_REDIS=1 TSX_TSCONFIG_PATH=apps/api/tsconfig.json \
  node --import tsx --test apps/api/tests/rateLimit.integration.ts >&2; then
  printf '{"name":"rate-limit-store","status":"pass","summary":"real Redis and independent API worker quota journeys pass","fix":""}\n'
else
  printf '{"name":"rate-limit-store","status":"fail","summary":"real Redis quota journeys failed","fix":"inspect retained diagnostics; Docker must support an isolated redis:7.4-alpine fixture; rerun npm run test:rate-limits -w apps/api"}\n'
  exit 1
fi
