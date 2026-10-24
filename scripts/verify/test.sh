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
  "") printf '{"name":"test","status":"fail","summary":"no affected test groups selected","fix":"choose a nonempty comparison or use --scope=all"}\n'; exit 1 ;;
  api|scripts|mobile|"api scripts"|"api mobile"|"scripts mobile"|"api scripts mobile") ;;
  *) printf '{"name":"test","status":"fail","summary":"invalid test group plan"}\n'; exit 1 ;;
esac
FAIL=""
REPORTS="$(mktemp -d "${TMPDIR:-/tmp}/fitsy-tests.XXXXXX")" || exit 1
trap 'rm -rf "$REPORTS"' EXIT
# Each engine must report passing cases from this invocation, even if it exits 0.
run_jest() {
  local group="$1"; shift
  "$@" --json --outputFile="$REPORTS/$group.json" >&2 &&
    node scripts/verify/test-results.mjs "$REPORTS/$group.json" jest >&2 || FAIL="${FAIL:+$FAIL, }$group"
}
run_node() {
  local group="$1"; shift
  node --test --test-reporter=spec --test-reporter-destination=stderr --test-reporter=./scripts/verify/node-focused-reporter.mjs --test-reporter-destination="$REPORTS/$group.json" "$@" >&2 &&
    node scripts/verify/test-results.mjs "$REPORTS/$group.json" node >&2 || FAIL="${FAIL:+$FAIL, }$group"
}
if [[ " $TEST_GROUPS " == *" scripts "* ]]; then
  unset FITSY_VERIFY_FOCUSED_RECIPE
  # Real decoder and attachment cases retain the required local media lane.
  run_jest scripts /usr/bin/env FITSY_MEDIA_INTEGRATION=0 NODE_OPTIONS=--max-old-space-size=512 npm test --workspace=@fitsy/scripts -- --maxWorkers=1 --workerIdleMemoryLimit=256MB
  run_node simple-review scripts/review/simple-review.test.mjs
  run_node github scripts/github/*.test.mjs
  for TEST in scripts/sim/retire_task_device.test.py scripts/review/advisory-finding.test.py; do
    report="$REPORTS/${TEST##*/}.json"
    PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify/python-focused.py "$TEST" "$report" >&2 &&
      node scripts/verify/test-results.mjs "$report" python >&2 || FAIL="${FAIL:+$FAIL, }$TEST"
  done
fi
if [[ " $TEST_GROUPS " == *" api "* ]]; then
  if [ -n "${POSTGRES_PRISMA_URL:-}" ]; then
    # Keep shared-schema suites serial while recycling retained suite modules.
    run_jest api /usr/bin/env NODE_OPTIONS=--max-old-space-size=512 npm run test:coverage:gc --workspace=apps/api -- --maxWorkers=1 --workerIdleMemoryLimit=256MB --logHeapUsage
  else
    run_jest api npm run test:coverage --workspace=apps/api --
  fi
fi
# One Jest worker keeps mobile suites serial while recycling its process after
# large files; in-band mode retains every suite in one process.
if [[ " $TEST_GROUPS " == *" mobile "* ]]; then
  run_jest mobile /usr/bin/env NODE_OPTIONS=--max-old-space-size=768 npm test --workspace=@fitsy/mobile -- --maxWorkers=1 --workerIdleMemoryLimit=256MB
fi
if [ -n "$FAIL" ]; then
  printf '{"name":"test","status":"fail","summary":"tests failed in: %s","fix":"run the failing workspace suite locally (npm run test:coverage -w apps/api or npm test -w @fitsy/scripts) and fix"}\n' "$FAIL"
  exit 1
fi
printf '{"name":"test","status":"pass","summary":"whole test groups passed: %s","fix":""}\n' "$TEST_GROUPS"
