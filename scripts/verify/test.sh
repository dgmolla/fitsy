#!/usr/bin/env bash
# Complete affected API, scripts and mobile groups. With a DB, serialize the
# whole API run: shared-schema suites can exhaust each other's SERIALIZABLE retry
# budget. Explicit concurrency inside a test remains unchanged.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
SCOPE=all
PLAN_ARGS=(--test-groups)
for ARG in "$@"; do
  case "$ARG" in
    --scope=all|--scope=changed) SCOPE="${ARG#--scope=}" ;;
    --base=*|--head=*) PLAN_ARGS+=("$ARG") ;;
    *) printf '{"name":"test","status":"fail","summary":"unsupported test argument"}\n'; exit 1 ;;
  esac
done
# Direct invocation remains full. Changed scope derives its own actual Git
# comparison, never a caller-selected group list or cached focused subset.
TEST_GROUPS="api scripts mobile"
if [ "$SCOPE" = changed ]; then
  if ! TEST_GROUPS="$(node scripts/verify/impact-plan.mjs "${PLAN_ARGS[@]}")"; then
    printf '{"name":"test","status":"fail","summary":"test group planning failed"}\n'; exit 1
  fi
fi
case "$TEST_GROUPS" in
  "") printf '{"name":"test","status":"skipped","summary":"documentation-only comparison"}\n'; exit 2 ;;
  api|scripts|mobile|"api scripts"|"api mobile"|"scripts mobile"|"api scripts mobile") ;;
  *) printf '{"name":"test","status":"fail","summary":"invalid test group plan"}\n'; exit 1 ;;
esac
FAIL=""
# Consume complete same-invocation focused proof before any other test engine
# can mutate the freshly prepared database. Missing proof keeps every file fresh.
if [[ " $TEST_GROUPS " == *" scripts "* ]]; then
  # Match focused Jest: recipe transport must not reach script assertions.
  unset FITSY_VERIFY_FOCUSED_RECIPE
  JEST_COMMAND=(test --workspace=@fitsy/scripts -- --maxWorkers=1 --workerIdleMemoryLimit=256MB)
  JEST_ENV=(FITSY_MEDIA_INTEGRATION=0 NODE_OPTIONS=--max-old-space-size=512)
  FOCUSED_IGNORE="$(/usr/bin/env "${JEST_ENV[@]}" node scripts/verify/receipt-cache.mjs --scripts-focused-exclusion "$PPID" "$@" -- "${JEST_COMMAND[@]}")" || FOCUSED_IGNORE=""
  if [ -n "$FOCUSED_IGNORE" ]; then
    JEST_COMMAND+=("--testPathIgnorePatterns=$FOCUSED_IGNORE" --passWithNoTests)
  fi
  # Real decoder and attachment cases retain the required local media lane.
  /usr/bin/env "${JEST_ENV[@]}" npm "${JEST_COMMAND[@]}" >&2 || FAIL="scripts"
fi
if [[ " $TEST_GROUPS " == *" scripts "* ]]; then
  node --test scripts/delivery/*.test.mjs >&2 || FAIL="${FAIL:+$FAIL, }delivery"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/delivery/local-report.test.py -q >&2 || FAIL="${FAIL:+$FAIL, }local-report"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/delivery/local-dispatcher.test.py -q >&2 || FAIL="${FAIL:+$FAIL, }local-dispatcher"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/delivery/pressure-retention.test.py -q >&2 || FAIL="${FAIL:+$FAIL, }pressure-retention"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/sim/retire_task_device.test.py -q >&2 || FAIL="${FAIL:+$FAIL, }retire-task-device"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/delivery/install-local-dispatcher.test.py -q >&2 || FAIL="${FAIL:+$FAIL, }install-local-dispatcher"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/review/advisory-finding.test.py -q >&2 || FAIL="${FAIL:+$FAIL, }advisory-finding"
fi
if [[ " $TEST_GROUPS " == *" api "* ]]; then
  if [ -n "${POSTGRES_PRISMA_URL:-}" ]; then
    # Keep shared-schema suites serial while recycling retained suite modules.
    NODE_OPTIONS=--max-old-space-size=512 npm run test:coverage:gc --workspace=apps/api -- --maxWorkers=1 --workerIdleMemoryLimit=256MB --logHeapUsage >&2 || FAIL="${FAIL:+$FAIL, }apps/api"
  else
    npm run test:coverage --workspace=apps/api >&2 || FAIL="${FAIL:+$FAIL, }apps/api"
  fi
fi
# One Jest worker keeps mobile suites serial while recycling its process after
# large files; in-band mode retains every suite in one process.
if [[ " $TEST_GROUPS " == *" mobile "* ]]; then
  NODE_OPTIONS=--max-old-space-size=768 npm test --workspace=@fitsy/mobile -- --maxWorkers=1 --workerIdleMemoryLimit=256MB >&2 || FAIL="${FAIL:+$FAIL, }mobile"
fi
if [ -n "$FAIL" ]; then
  printf '{"name":"test","status":"fail","summary":"tests failed in: %s","fix":"run the failing workspace suite locally (npm run test:coverage -w apps/api or npm test -w @fitsy/scripts) and fix"}\n' "$FAIL"
  exit 1
fi
printf '{"name":"test","status":"pass","summary":"whole test groups passed: %s","fix":""}\n' "$TEST_GROUPS"
