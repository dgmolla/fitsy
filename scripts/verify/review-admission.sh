#!/bin/bash -p
set -euo pipefail
unset BASH_ENV ENV NODE_OPTIONS NODE_PATH
PATH=/Applications/Xcode.app/Contents/Developer/usr/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONTROL_ROOT="$REPO_ROOT"
# Clear selectors before any child shell or Git source read. Privileged Bash
# ignores function imports but preserves their entries for ordinary children.
selected_environment=()
while IFS= read -r -d '' name; do
  selected_environment+=(-u "$name")
done < <(node -e 'for (const key of Object.keys(process.env)) if (key.startsWith("BASH_FUNC_") || key.startsWith("GIT_")) process.stdout.write(key + "\0")')
if [ "${#selected_environment[@]}" -gt 0 ]; then
  exec /usr/bin/env "${selected_environment[@]}" /bin/bash -p "$CONTROL_ROOT/scripts/verify/review-admission.sh" "$@"
fi
REPO_ROOT="${FITSY_SHIPPING_ROOT:-$REPO_ROOT}"
cd "$REPO_ROOT"
REVIEW_ARGS=(--local --cached-only)
SESSION_REVALIDATION=0
[ -z "${FITSY_GH_BIN:-}" ] || { echo 'caller-selected GitHub executable cannot authorize shipping' >&2; exit 1; }
# Known administrator installation locations, never caller PATH or a private copy.
TRUSTED_GH=/opt/homebrew/bin/gh
if [ ! -x "$TRUSTED_GH" ]; then TRUSTED_GH=/usr/local/bin/gh; fi
if [ ! -x "$TRUSTED_GH" ]; then TRUSTED_GH=/usr/bin/gh; fi
[ -x "$TRUSTED_GH" ] || { echo 'administrator GitHub CLI unavailable' >&2; exit 1; }
for ARG in "$@"; do
  case "$ARG" in
    --revalidate-session) SESSION_REVALIDATION=1 ;;
    --execute-review) REVIEW_ARGS=(--local) ;;
    --scope=*) ;; # Canonical verify runner passes its scope to check scripts.
    *) echo "unsupported review admission argument: $ARG" >&2; exit 1 ;;
  esac
done
if [ "$SESSION_REVALIDATION" = 1 ]; then
  [ -n "${FITSY_SHIPPING_SOCKET:-}" ] && [ -n "${FITSY_SHIPPING_TOKEN:-}" ] && \
    [ "${REVIEW_ARGS[*]}" = '--local --cached-only' ] || exit 1
fi
if [ "$SESSION_REVALIDATION" = 0 ] && [ -n "${FITSY_SHIPPING_SOCKET-}${FITSY_SHIPPING_TOKEN-}" ]; then
  # Socket data cannot substitute for administrator-managed review authority.
  /bin/bash -p "$CONTROL_ROOT/scripts/verify/review-admission.sh" --revalidate-session || exit 1
  "$CONTROL_ROOT/scripts/verify/shipping-session.mjs" --check || {
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
# Local acceptance derives its range from authenticated source, never the caller.
unset FITSY_DIFF_BASE FITSY_DIFF_HEAD
ADMIN_HOME="$(python3 -I -c 'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
for NAME in FITSY_REVIEW_HOME FITSY_REVIEW_CACHE; do
  [ -z "${!NAME:-}" ] || { echo "caller-selected $NAME cannot authorize shipping" >&2; fail; }
done
TRUSTED_REPO="$ADMIN_HOME/.fitsy-review/repo"
BASE_SHA="$(git -C "$TRUSTED_REPO" rev-parse refs/remotes/origin/main)" || fail
ISSUE="$(python3 -I -c 'import json; print(json.load(open(".evidence/delivery/binding.json"))["issue"])')" || fail
# Canonical manifests are operator policy, not legacy completed authorizations.
# Only the fixed installed adapter may select this route; a refused configured
# authority never falls back to a different review or candidate-owned receipt.
CANONICAL_ADAPTER=/opt/fitsy-approval/external-approval.py
candidate_checks() {
  [ -f "$CANONICAL_ADAPTER" ] || { echo 'isolated candidate check authority unavailable' >&2; return 1; }
  /usr/bin/python3 -I -B "$CANONICAL_ADAPTER" candidate-checks --issue "$ISSUE" \
    --source "$HEAD_SHA" --base "$BASE_SHA" --root "$REPO_ROOT" --check cheap
}

if [ -f "$CANONICAL_ADAPTER" ]; then
  [ "$(git rev-parse origin/main)" = "$BASE_SHA" ] || fail
  if [ "$REPO_ROOT" != "$CONTROL_ROOT" ]; then
    [ "$(git -C "$CONTROL_ROOT" rev-parse HEAD)" = "$BASE_SHA" ] && \
      [ -z "$(git -C "$CONTROL_ROOT" status --porcelain --untracked-files=all)" ] || fail
  fi
  DOMAINS="$(git diff --name-only --no-renames "$BASE_SHA...$HEAD_SHA" | python3 -I "$CONTROL_ROOT/scripts/review/review-domains.py")" || fail
  CANONICAL_ARGS=(validate-review --issue "$ISSUE" --source "$HEAD_SHA" --base "$BASE_SHA")
  for DOMAIN in $DOMAINS; do CANONICAL_ARGS+=(--domain "$DOMAIN"); done
  CANONICAL_CODE=0
  CANONICAL_RESULT="$(/usr/bin/python3 -I -B "$CANONICAL_ADAPTER" "${CANONICAL_ARGS[@]}")" || CANONICAL_CODE=$?
  if [ "$CANONICAL_CODE" = 0 ]; then
    if [ "$SESSION_REVALIDATION" = 0 ]; then
      export FITSY_DIFF_BASE="$BASE_SHA" FITSY_DIFF_HEAD="$HEAD_SHA"
      candidate_checks >&2 || fail
      # Recheck protected authority after cheap checks, without provider execution.
      CANONICAL_RESULT="$(/usr/bin/python3 -I -B "$CANONICAL_ADAPTER" "${CANONICAL_ARGS[@]}")" || fail
    fi
    printf '%s' "$CANONICAL_RESULT" | python3 -I -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("canonical_review") == "pass" and d.get("source_sha") == sys.argv[1] and d.get("base_sha") == sys.argv[2]
' "$HEAD_SHA" "$BASE_SHA" || fail
    [ "$(git rev-parse HEAD)" = "$HEAD_SHA" ] && [ "$(git rev-parse origin/main)" = "$BASE_SHA" ] && \
      [ "$(git -C "$TRUSTED_REPO" rev-parse origin/main)" = "$BASE_SHA" ] && \
      [ -z "$(git status --porcelain --untracked-files=all)" ] || fail
    echo '{"name":"review-admission","status":"pass","summary":"protected canonical review and required tests admit this exact source","fix":""}'
    exit 0
  fi
  [ "$CANONICAL_CODE" = 2 ] && [ "$CANONICAL_RESULT" = '{"canonical_review": "not_configured"}' ] || fail
fi
if [ "$REPO_ROOT" != "$CONTROL_ROOT" ]; then
  [ "$(git -C "$CONTROL_ROOT" rev-parse HEAD)" = "$BASE_SHA" ] || fail
  [ -z "$(git -C "$CONTROL_ROOT" status --porcelain --untracked-files=all)" ] || fail
fi
[ "$(git rev-parse origin/main)" = "$BASE_SHA" ] || fail
export FITSY_DIFF_BASE="$BASE_SHA" FITSY_DIFF_HEAD="$HEAD_SHA"
BRANCH="$(git symbolic-ref --quiet --short HEAD)"
# Direct admission completes cheap checks before validating independent evidence.
if [ "$SESSION_REVALIDATION" = 0 ]; then
  candidate_checks >&2 || fail
fi
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
# Preserve source-bound disposition and test context.
for CONTEXT in review-dispositions review-tests; do
  if [ -e "$REPO_ROOT/.evidence/$CONTEXT" ]; then
    cp -R "$REPO_ROOT/.evidence/$CONTEXT" "$ATTEMPT/candidate/.evidence/$CONTEXT" || fail
  fi
done
# Revalidate only the established external cache.
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
(cd "$ATTEMPT/candidate"; FITSY_GH_BIN="$TRUSTED_GH" FITSY_REVIEW_ADMIN_GH=1 FITSY_REVIEW_FRESH_EXECUTION=1 FITSY_REVIEW_CACHE="$REVIEW_CACHE" \
  /bin/bash -p scripts/review/run-review.sh "${REVIEW_ARGS[@]}" > "$ATTEMPT/result.json" 2> "$ATTEMPT/review.log") || REVIEW_CODE=$?
cat "$ATTEMPT/review.log" >&2
[ "$REVIEW_CODE" = 0 ] || fail
[ "$(git rev-parse HEAD)" = "$HEAD_SHA" ] && [ "$(git rev-parse origin/main)" = "$BASE_SHA" ] && \
  [ "$(git -C "$TRUSTED_REPO" rev-parse origin/main)" = "$BASE_SHA" ] && \
  [ -z "$(git status --porcelain --untracked-files=all)" ] || fail
echo '{"name":"review-admission","status":"pass","summary":"validated exact-head independent review permits full acceptance","fix":""}'
