#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
if [ -n "${FITSY_SHIPPING_SOCKET-}${FITSY_SHIPPING_TOKEN-}" ]; then
  node scripts/verify/shipping-session.mjs --check || {
    echo '{"name":"review-admission","status":"fail","summary":"active shipping candidate is invalid","fix":"restart cheap checks and fresh review on frozen source"}'
    exit 1
  }
  echo '{"name":"review-admission","status":"pass","summary":"same live shipping execution still owns current candidate admission","fix":""}'
  exit 0
fi
fail() {
  echo '{"name":"review-admission","status":"fail","summary":"fresh source-bound independent review did not pass","fix":"repair cheap checks or confirmed findings and rerun on frozen source; raw attempts are retained"}'
  exit 1
}
[ -z "$(git status --porcelain --untracked-files=all)" ] || fail
HEAD_SHA="$(git rev-parse HEAD)"
TRUSTED_REPO="${FITSY_REVIEW_HOME:-$HOME/.fitsy-review}/repo"
BASE_SHA="$(git -C "$TRUSTED_REPO" rev-parse refs/remotes/origin/main)" || fail
[ "$(git rev-parse origin/main)" = "$BASE_SHA" ] || fail
BRANCH="$(git symbolic-ref --quiet --short HEAD)"
# No review receipt is reused. Direct admission also completes the cheap stage.
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
# A new execution directory prevents legacy main from reading any candidate
# cache. New main additionally ignores all cache reads in fresh execution mode.
REVIEW_CODE=0
(cd "$ATTEMPT/candidate"; FITSY_REVIEW_FRESH_EXECUTION=1 FITSY_REVIEW_CACHE="$ATTEMPT/execution-cache" \
  bash scripts/review/run-review.sh --local > "$ATTEMPT/result.json" 2> "$ATTEMPT/review.log") || REVIEW_CODE=$?
cat "$ATTEMPT/review.log" >&2
[ "$REVIEW_CODE" = 0 ] || fail
[ "$(git rev-parse HEAD)" = "$HEAD_SHA" ] && [ "$(git rev-parse origin/main)" = "$BASE_SHA" ] && \
  [ -z "$(git status --porcelain --untracked-files=all)" ] || fail
echo '{"name":"review-admission","status":"pass","summary":"fresh canonical exact-head independent review permits full acceptance","fix":""}'
