#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONTROL_ROOT="$REPO_ROOT"
REPO_ROOT="${FITSY_SHIPPING_ROOT:-$REPO_ROOT}"
cd "$REPO_ROOT"
REVIEW_ARGS=(--local --cached-only)
for ARG in "$@"; do
  case "$ARG" in
    --execute-review) REVIEW_ARGS=(--local) ;;
    --scope=*) ;; # Canonical verify runner passes its scope to check scripts.
    *) echo "unsupported review admission argument: $ARG" >&2; exit 1 ;;
  esac
done
if [ -n "${FITSY_SHIPPING_SOCKET-}${FITSY_SHIPPING_TOKEN-}" ]; then
  node scripts/verify/shipping-session.mjs --check || {
    echo '{"name":"review-admission","status":"fail","summary":"active shipping candidate is invalid","fix":"revalidate cheap checks and matching review on frozen source"}'
    exit 1
  }
  echo '{"name":"review-admission","status":"pass","summary":"same live shipping execution still owns current candidate admission","fix":""}'
  exit 0
fi
fail() {
  echo '{"name":"review-admission","status":"fail","summary":"source-bound independent review admission did not pass","fix":"repair cheap checks or confirmed findings and rerun on frozen source; raw attempts are retained"}'
  exit 1
}
[ -z "$(git status --porcelain --untracked-files=all)" ] || fail
HEAD_SHA="$(git rev-parse HEAD)"
TRUSTED_REPO="${FITSY_REVIEW_HOME:-$HOME/.fitsy-review}/repo"
BASE_SHA="$(git -C "$TRUSTED_REPO" rev-parse refs/remotes/origin/main)" || fail
ISSUE="$(python3 -I -c 'import json; print(json.load(open(".evidence/delivery/binding.json"))["issue"])')" || fail
COMPLETED_AUTH="${FITSY_REVIEW_COMPLETED_HOME:-${FITSY_REVIEW_HOME:-$HOME/.fitsy-review}/completed}/issue-$ISSUE.json"
if [ "$REPO_ROOT" != "$CONTROL_ROOT" ]; then
  [ -f "$COMPLETED_AUTH" ] || fail
  [ "$(git -C "$CONTROL_ROOT" rev-parse HEAD)" = "$BASE_SHA" ] || fail
  [ -z "$(git -C "$CONTROL_ROOT" status --porcelain --untracked-files=all)" ] || fail
fi
if [ -f "$COMPLETED_AUTH" ]; then
  COMPARE_SHA="$(python3 -I "$CONTROL_ROOT/scripts/review/review-budget.py" completed-context \
    --ledger /dev/null --authorization-file "$COMPLETED_AUTH" --issue "$ISSUE" --source-sha "$HEAD_SHA")" || fail
  [ "$(git rev-parse origin/main)" = "$COMPARE_SHA" ] || fail
else
  [ "$(git rev-parse origin/main)" = "$BASE_SHA" ] || fail
fi
BRANCH="$(git symbolic-ref --quiet --short HEAD)"
# Direct admission completes cheap checks before validating independent evidence.
node scripts/verify/run.mjs --layer=0-2 --stage=cheap --scope=changed --runs=local >&2 || fail
[ "$(git rev-parse HEAD)" = "$HEAD_SHA" ] && [ -z "$(git status --porcelain --untracked-files=all)" ] || fail
mkdir -p .evidence/review-admission
ATTEMPT="$(mktemp -d "$REPO_ROOT/.evidence/review-admission/attempt.XXXXXX")"
# Follow the established poller pattern: committed candidate context, but only
# existing managed main reviewer controls execute. This is disposable execution,
# without installing candidate controls, bootstrap keys or saved-pass projection.
git -c core.hooksPath=/dev/null clone --quiet --shared --no-checkout "$TRUSTED_REPO" "$ATTEMPT/candidate" >&2 || fail
git -C "$ATTEMPT/candidate" config core.hooksPath /dev/null
git -C "$ATTEMPT/candidate" remote set-url origin https://github.com/dgmolla/fitsy.git
git -C "$ATTEMPT/candidate" fetch --quiet "$REPO_ROOT" "$HEAD_SHA" >&2 || fail
git -C "$ATTEMPT/candidate" checkout --quiet -B "$BRANCH" "$HEAD_SHA" >&2 || fail
git -C "$ATTEMPT/candidate" update-ref refs/remotes/origin/main "$BASE_SHA"
CONTROLS=(scripts/review scripts/verify/risk-tiers.yml REVIEW.md .claude/lenses)
if git cat-file -e "$BASE_SHA:scripts/delivery/phase-events.mjs" 2>/dev/null; then CONTROLS+=(scripts/delivery/phase-events.mjs); fi
git -C "$ATTEMPT/candidate" restore --source="$BASE_SHA" --staged --worktree --no-overlay -- "${CONTROLS[@]}" >&2 || fail
git -C "$ATTEMPT/candidate" clean -qfdx -- scripts/review .claude/lenses
mkdir -p "$ATTEMPT/candidate/.evidence/delivery"
cp .evidence/delivery/binding.json "$ATTEMPT/candidate/.evidence/delivery/binding.json" || fail
# Preserve the canonical migration and source-bound disposition/test contract.
for CONTEXT in review-budget.jsonl review-dispositions review-tests; do
  if [ -e "$REPO_ROOT/.evidence/$CONTEXT" ]; then
    cp -R "$REPO_ROOT/.evidence/$CONTEXT" "$ATTEMPT/candidate/.evidence/$CONTEXT" || fail
  fi
done
# Revalidate only the established external cache or authorized original evidence.
# A session restart does not authorize reviewer execution. Explicit execution uses
# this same trusted overlay and writes the canonical cache for later admission.
REVIEW_CACHE="${FITSY_REVIEW_CACHE:-$HOME/.cache/fitsy-review}"
python3 -I - "$REVIEW_CACHE" "$REPO_ROOT" <<'PYCACHE'
import os,pathlib,subprocess,sys
cache=pathlib.Path(sys.argv[1]).resolve()
root=pathlib.Path(sys.argv[2]).resolve()
if cache == root or root in cache.parents: sys.exit('admission cache must be outside candidate checkout')
probe=cache
while not probe.exists(): probe=probe.parent
env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
if subprocess.run(['git','-C',str(probe),'rev-parse','--show-toplevel'],env=env,capture_output=True).returncode == 0:
    sys.exit('admission cache must be outside every Git checkout')
cache.mkdir(parents=True,exist_ok=True)
PYCACHE

REVIEW_CODE=0
(cd "$ATTEMPT/candidate"; FITSY_REVIEW_FRESH_EXECUTION=1 FITSY_REVIEW_CACHE="$REVIEW_CACHE" \
  bash scripts/review/run-review.sh "${REVIEW_ARGS[@]}" > "$ATTEMPT/result.json" 2> "$ATTEMPT/review.log") || REVIEW_CODE=$?
cat "$ATTEMPT/review.log" >&2
[ "$REVIEW_CODE" = 0 ] || fail
[ "$(git rev-parse HEAD)" = "$HEAD_SHA" ] && [ "$(git rev-parse origin/main)" = "${COMPARE_SHA:-$BASE_SHA}" ] && \
  [ -z "$(git status --porcelain --untracked-files=all)" ] || fail
echo '{"name":"review-admission","status":"pass","summary":"validated exact-head independent review permits full acceptance","fix":""}'
