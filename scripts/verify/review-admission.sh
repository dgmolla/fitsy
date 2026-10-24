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
    --scope=*) ;; # Canonical verify runner passes its scope to check scripts.
    *) echo "unsupported review admission argument: $ARG" >&2; exit 1 ;;
  esac
done
if [ "$SESSION_REVALIDATION" = 1 ]; then
  [ -n "${FITSY_SHIPPING_SOCKET:-}" ] && [ -n "${FITSY_SHIPPING_TOKEN:-}" ] || exit 1
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
for NAME in FITSY_REVIEW_HOME FITSY_REVIEW_CACHE FITSY_REVIEW_BUDGET_HOME FITSY_REVIEW_COMPLETED_HOME; do
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
  DOMAINS="$(git diff --name-only --no-renames "$BASE_SHA...$HEAD_SHA" | node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const { selectLenses } = await import(process.argv[1]);
    console.log(selectLenses(readFileSync(0, "utf8"), process.argv[2]).join(" "));
  ' "$CONTROL_ROOT/scripts/review/simple-review.mjs" "$CONTROL_ROOT")" || fail
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
echo "legacy review execution and cache admission are retired; canonical review authority is required" >&2
fail
