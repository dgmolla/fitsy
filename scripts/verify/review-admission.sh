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
ADMIN_HOME="$(python3 -I -c 'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
for NAME in FITSY_REVIEW_HOME FITSY_REVIEW_CACHE FITSY_REVIEW_BUDGET_HOME FITSY_REVIEW_COMPLETED_HOME; do
  [ -z "${!NAME:-}" ] || { echo "caller-selected $NAME cannot authorize shipping" >&2; fail; }
done
TRUSTED_REPO="$ADMIN_HOME/.fitsy-review/repo"
BASE_SHA="$(git -C "$TRUSTED_REPO" rev-parse refs/remotes/origin/main)" || fail
ISSUE="$(python3 -I -c 'import json; print(json.load(open(".evidence/delivery/binding.json"))["issue"])')" || fail
COMPLETED_AUTH="$ADMIN_HOME/.fitsy-review/completed/issue-$ISSUE.json"
# The permanent human exception permits a separately installed, independently
# reviewed operator to bootstrap this recovery outcome only. It is never main
# identity, never a nutrition admission, and never permission to execute review.
if [ -n "${FITSY_REVIEW_BOOTSTRAP_OPERATOR:-}" ]; then
  [ "$ISSUE" = 463 ] && [ "$REPO_ROOT" = "$CONTROL_ROOT" ] && [ -f "$COMPLETED_AUTH" ] || fail
  [ "${REVIEW_ARGS[*]}" = '--local --cached-only' ] || fail
  [ "$FITSY_REVIEW_BOOTSTRAP_OPERATOR" = "$ADMIN_HOME/.fitsy-review/operators/review-budget.py" ] || fail
  python3 -I - "$FITSY_REVIEW_BOOTSTRAP_OPERATOR" "$COMPLETED_AUTH" "$HEAD_SHA" <<'PYBOOTSTRAP' || fail
import hashlib,json,os,pathlib,sys
operator,authority=map(pathlib.Path,sys.argv[1:3])
for path in (operator,authority):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        sys.exit('bootstrap requires canonical private administrator installation and approval')
approval=json.loads(authority.read_text())
if (approval.get('issue') != 463 or approval.get('source_sha') != sys.argv[3]
        or approval.get('control_sha') != sys.argv[3]
        or approval.get('operator_sha256') != hashlib.sha256(operator.read_bytes()).hexdigest()):
    sys.exit('coordinator has not independently approved this exact operator/source')
PYBOOTSTRAP
  # Only the coordinator may approve/install this exact operator after review.
  # admit-completed checks its canonical approval and digest before accounting.
  node scripts/verify/run.mjs --layer=0-2 --stage=cheap --scope=changed --runs=local >&2 || fail
  BRANCH="$(git symbolic-ref --quiet --short HEAD)"
  ACCEPTANCE="$(gh issue view "$ISSUE" --json body --jq .body | python3 -I -c '
import re,sys
kept=[]; details=False
for line in sys.stdin.read().splitlines():
    if re.match(r"^\s*<details(?:\s|>)",line,re.I): details=True
    if not details and re.match(r"^\s*(?:\*\*)?(?:Status|Next|Done|Blocker)(?:\*\*)?\s*:",line,re.I): continue
    kept.append(line)
print("\n".join(kept))')" || fail
  ARGS=(--ledger "$ADMIN_HOME/.cache/fitsy-review/budgets/issue-$ISSUE.jsonl" --issue "$ISSUE"
    --candidate "$(git rev-list --max-parents=0 HEAD | sort):$BRANCH"
    --source-sha "$HEAD_SHA" --base-sha "$(git rev-parse origin/main)"
    --control-sha "$HEAD_SHA" --candidate-root "$REPO_ROOT" --authorization-file "$COMPLETED_AUTH"
    --acceptance-sha256 "$(printf '%s' "$ACCEPTANCE" | shasum -a 256 | cut -d' ' -f1)")
  DOMAINS="$(git diff --name-only --no-renames origin/main...HEAD | python3 -I scripts/review/review-domains.py)" || fail
  for DOMAIN in $DOMAINS; do ARGS+=(--required-domain "$DOMAIN"); done
  python3 -I "$FITSY_REVIEW_BOOTSTRAP_OPERATOR" admit-completed "${ARGS[@]}" >&2 || fail
  [ "$(git rev-parse HEAD)" = "$HEAD_SHA" ] && [ -z "$(git status --porcelain --untracked-files=all)" ] || fail
  echo '{"name":"review-admission","status":"pass","summary":"independently reviewed bootstrap operator validated genuine source-bound evidence","fix":""}'
  exit 0
fi
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
REVIEW_CACHE="$ADMIN_HOME/.cache/fitsy-review"
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
(cd "$ATTEMPT/candidate"; FITSY_REVIEW_FRESH_EXECUTION=1 FITSY_REVIEW_CACHE="$REVIEW_CACHE" FITSY_REVIEW_BUDGET_HOME="$REVIEW_CACHE/budgets" FITSY_REVIEW_COMPLETED_HOME="$ADMIN_HOME/.fitsy-review/completed" \
  bash scripts/review/run-review.sh "${REVIEW_ARGS[@]}" > "$ATTEMPT/result.json" 2> "$ATTEMPT/review.log") || REVIEW_CODE=$?
cat "$ATTEMPT/review.log" >&2
[ "$REVIEW_CODE" = 0 ] || fail
[ "$(git rev-parse HEAD)" = "$HEAD_SHA" ] && [ "$(git rev-parse origin/main)" = "${COMPARE_SHA:-$BASE_SHA}" ] && \
  [ -z "$(git status --porcelain --untracked-files=all)" ] || fail
echo '{"name":"review-admission","status":"pass","summary":"validated exact-head independent review permits full acceptance","fix":""}'
