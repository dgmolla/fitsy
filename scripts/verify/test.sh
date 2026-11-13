#!/usr/bin/env bash
# Related PR suites, with complete groups for ambiguous inputs. With a DB, serialize the
# whole API run: shared-schema suites can exhaust each other's SERIALIZABLE retry
# budget. Explicit concurrency inside a test remains unchanged.
# Keep workspace output complete for run.mjs's retained stdout/stderr logs.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1
SCOPE=all
PLAN_ARGS=(--test-groups)
for ARG in "$@"; do
  case "$ARG" in
    --scope=all|--scope=changed) SCOPE="${ARG#--scope=}" ;;
    --base=*|--head=*) PLAN_ARGS+=("$ARG") ;;
    *) printf '{"name":"test","status":"fail","summary":"unsupported test argument"}\n'; exit 1 ;;
  esac
done
# Direct invocation and pushes remain full. Changed scope derives its own actual
# Git comparison, never a caller-selected group list or cached focused subset.
TEST_GROUPS="api scripts mobile"
if [ "$SCOPE" = changed ] && [ "${GITHUB_EVENT_NAME:-}" != push ] && [ "${GITHUB_EVENT_NAME:-}" != pull_request ]; then
  if ! TEST_GROUPS="$(node scripts/verify/impact-plan.mjs "${PLAN_ARGS[@]}")"; then
    printf '{"name":"test","status":"fail","summary":"test group planning failed"}\n'; exit 1
  fi
fi
case "$TEST_GROUPS" in
  "") printf '{"name":"test","status":"fail","summary":"no affected test groups selected","fix":"choose a nonempty comparison or use --scope=all"}\n'; exit 1 ;;
  api|scripts|mobile|"api scripts"|"api mobile"|"scripts mobile"|"api scripts mobile") ;;
  *) printf '{"name":"test","status":"fail","summary":"invalid test group plan"}\n'; exit 1 ;;
esac
case "${FITSY_VERIFY_TEST_GROUP:-}" in ""|api|scripts|mobile) ;;
  *) printf '{"name":"test","status":"fail","summary":"invalid FITSY_VERIFY_TEST_GROUP"}\n'; exit 1 ;;
esac
FAIL=""
REPORTS="$(mktemp -d "${TMPDIR:-/tmp}/fitsy-tests.XXXXXX")" || exit 1
trap 'rm -rf "$REPORTS"' EXIT
MODE=whole
MOBILE_ARGS=()
SCRIPTS_ARGS=()
if [ "$SCOPE" = changed ] && [ "${GITHUB_EVENT_NAME:-}" = pull_request ]; then
  if ! node scripts/verify/related-tests.mjs "${PLAN_ARGS[@]:1}" > "$REPORTS/selection.json"; then
    printf '{"name":"test","status":"fail","summary":"related test planning failed"}\n'; exit 1
  fi
  cat "$REPORTS/selection.json" >&2
  MODE="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).mode)' "$REPORTS/selection.json")" || exit 1
  if [ "$MODE" = related ]; then
    TEST_GROUPS=""
    node scripts/verify/related-tests.mjs --read "$REPORTS/selection.json" mobile > "$REPORTS/mobile.paths" || exit 1
    node scripts/verify/related-tests.mjs --read "$REPORTS/selection.json" scripts > "$REPORTS/scripts.paths" || exit 1
    while IFS= read -r -d '' path; do MOBILE_ARGS+=("$path"); done < "$REPORTS/mobile.paths"
    while IFS= read -r -d '' path; do SCRIPTS_ARGS+=("$path"); done < "$REPORTS/scripts.paths"
    if [ "${#MOBILE_ARGS[@]}" -gt 0 ]; then TEST_GROUPS="mobile"; MOBILE_ARGS=(--runTestsByPath "${MOBILE_ARGS[@]}"); fi
    if [ "${#SCRIPTS_ARGS[@]}" -gt 0 ]; then TEST_GROUPS="scripts $TEST_GROUPS"; SCRIPTS_ARGS=(--runTestsByPath "${SCRIPTS_ARGS[@]}"); fi
    if [ -z "$TEST_GROUPS" ]; then
      printf '{"name":"test","status":"fail","summary":"empty related test selection"}\n'; exit 1
    fi
  elif [ "$MODE" != full ]; then
    printf '{"name":"test","status":"fail","summary":"invalid related test plan"}\n'; exit 1
  fi
fi
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
# A hosted shard runs exactly one of api/scripts/mobile in parallel with the
# others (same commands and worker limits as the unsharded run); narrow the
# already-computed selection to this shard and skip cleanly if its group
# isn't in it. Local/unsharded callers never set this and are unaffected.
SHARD="${FITSY_VERIFY_TEST_GROUP:-}"
SHARD_APPLICABLE=1
if [ -n "$SHARD" ]; then
  case " $TEST_GROUPS " in
    *" $SHARD "*) SHARD_APPLICABLE=1; TEST_GROUPS="$SHARD" ;;
    *) SHARD_APPLICABLE=0; TEST_GROUPS="" ;;
  esac
fi
# Shared pure contracts run with every affected group; they need no database.
run_jest shared npm test --workspace=@fitsy/shared --
if [[ " $TEST_GROUPS " == *" scripts "* ]]; then
  unset FITSY_VERIFY_FOCUSED_RECIPE
  # Real decoder and attachment cases retain the required local media lane.
  run_jest scripts /usr/bin/env FITSY_MEDIA_INTEGRATION=0 NODE_OPTIONS=--max-old-space-size=512 npm test --workspace=@fitsy/scripts -- --maxWorkers=1 --workerIdleMemoryLimit=256MB ${SCRIPTS_ARGS[@]+"${SCRIPTS_ARGS[@]}"}
fi
if [[ " $TEST_GROUPS " == *" scripts "* ]] && [ "$MODE" != related ]; then
  run_node simple-review scripts/review/simple-review.test.mjs
  run_node github scripts/github/*.test.mjs
  run_node performance scripts/perf/*.test.mjs
  run_node database-roles scripts/deploy/pipeline-roles-approval.test.mjs
  report="$REPORTS/cleanup.json"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify/python-focused.py scripts/delivery/cleanup.test.py "$report" >&2 &&
    node scripts/verify/test-results.mjs "$report" python >&2 || FAIL="${FAIL:+$FAIL, }cleanup"
  report="$REPORTS/loop-recovery.json"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify/python-focused.py scripts/delivery/loop/loop.test.py "$report" >&2 &&
    node scripts/verify/test-results.mjs "$report" python >&2 || FAIL="${FAIL:+$FAIL, }loop-recovery"
  report="$REPORTS/loop-worktrees.json"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify/python-focused.py scripts/delivery/loop/worktrees.test.py "$report" >&2 &&
    node scripts/verify/test-results.mjs "$report" python >&2 || FAIL="${FAIL:+$FAIL, }loop-worktrees"
  report="$REPORTS/loop-open-prs.json"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify/python-focused.py scripts/delivery/loop/open_prs.test.py "$report" >&2 &&
    node scripts/verify/test-results.mjs "$report" python >&2 || FAIL="${FAIL:+$FAIL, }loop-open-prs"
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
  run_jest mobile /usr/bin/env NODE_OPTIONS=--max-old-space-size=768 npm test --workspace=@fitsy/mobile -- --maxWorkers=1 --workerIdleMemoryLimit=256MB ${MOBILE_ARGS[@]+"${MOBILE_ARGS[@]}"}
fi
if [ -n "$FAIL" ]; then
  printf '{"name":"test","status":"fail","summary":"tests failed in: %s","fix":"inspect the test logs listed by Verify; rerun the failing suite (npm run test:coverage -w apps/api, npm test -w @fitsy/scripts, or npm test -w @fitsy/mobile) and fix"}\n' "$FAIL"
  exit 1
fi
if [ -n "$SHARD" ] && [ "$SHARD_APPLICABLE" = 0 ]; then
  printf '{"name":"test","status":"skipped","summary":"%s not affected by this change"}\n' "$SHARD"
  exit 2
fi
printf '{"name":"test","status":"pass","summary":"%s test groups passed: %s","fix":""}\n' "$MODE" "$TEST_GROUPS"
