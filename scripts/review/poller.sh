#!/usr/bin/env bash
# Local review runner: find open PRs whose head commit lacks a completed lens status and
# run the appropriate lens. Installed as a LaunchAgent by install-poller.sh;
# also runnable by hand. Reviews on the Max subscription (no API billing).
#
# Runs in its own clone (~/.fitsy-review/repo) so it never touches a working
# tree an agent or human is editing.
set -uo pipefail
REVIEW_HOME="${FITSY_REVIEW_HOME:-$HOME/.fitsy-review}"
GH_BIN="${FITSY_GH_BIN:-gh}"
REPO_DIR="$REVIEW_HOME/repo"
LOG="$REVIEW_HOME/poller.log"
mkdir -p "$REVIEW_HOME"
exec >>"$LOG" 2>&1
echo "[poller] $(date -u +%FT%TZ) tick"

if [ ! -d "$REPO_DIR/.git" ]; then
  "$GH_BIN" repo clone dgmolla/fitsy "$REPO_DIR" -- --quiet || { echo "[poller] clone failed"; exit 0; }
fi
cd "$REPO_DIR" || exit 1
if ! (git fetch -q origin && git checkout -qf origin/main 2>/dev/null); then
  echo "[poller] trusted main checkout unavailable; stopping this tick"
  exit 1
fi

"$GH_BIN" pr list --state open --json number,headRefOid --limit 20 --jq '.[] | "\(.number) \(.headRefOid)"' |
while read -r NUM SHA; do
  # The trusted main runner owns routing and complete-result projections.
  # Legacy independent lens statuses cannot prove a consolidated round.
  if ! STATUS_ROWS="$("$GH_BIN" api "repos/{owner}/{repo}/commits/$SHA/statuses?per_page=100" 2>/dev/null)" || ! printf '%s' "$STATUS_ROWS" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "[poller] PR #$NUM: status read failed; skipping this tick"
    continue
  fi
  STATE="$(printf '%s' "$STATUS_ROWS" | jq -r --arg lens review/round -f scripts/review/poller-status.jq)"
  PRIOR_DESCRIPTION="$(printf '%s' "$STATUS_ROWS" | jq -r '[.[] | select(.context == "review/round")] | sort_by(.created_at,.id) | last | .description // ""')"
  if [ "$STATE" = failure ]; then
    case "$PRIOR_DESCRIPTION" in needs-coordinator:*) continue ;; esac
  fi
  ATTEMPT_TIMEOUT="${FITSY_REVIEW_TIMEOUT_SECONDS:-900}"
  if [ "$STATE" = error ]; then
    ERRORS="$(printf '%s' "$STATUS_ROWS" | jq '[.[] | select(.context == "review/round" and .state == "error")] | length')"
    ERROR_DESCRIPTION="$(printf '%s' "$STATUS_ROWS" | jq -r '[.[] | select(.context == "review/round" and .state == "error")][0].description // ""')"
    RETRYABLE=0
    case "$ERROR_DESCRIPTION" in execution/timeout:*|execution/transient_provider:*) RETRYABLE=1 ;; esac
    if [ "$ERRORS" -ge 2 ] || [ "$RETRYABLE" = 0 ]; then
      "$GH_BIN" api "repos/{owner}/{repo}/statuses/$SHA" -f state=failure -f context=review/round -f description='needs-coordinator: independent review requires diagnosed execution recovery' >/dev/null || true
      echo "[poller] PR #$NUM: needs-coordinator; raw incomplete attempts retained"
      continue
    fi
    ATTEMPT_TIMEOUT="$(python3 -I -c 'import sys; n=int(sys.argv[1]); assert 1<=n<=3600; print(min(3600,n*2))' "$ATTEMPT_TIMEOUT")"
  fi
  echo "[poller] reviewing complete round PR #$NUM at ${SHA:0:7}"
  # Check out the PR head so the lens reads the branch's actual file context;
  # fail closed: reviewing against stale context is worse than waiting a tick.
  if ! (git fetch -q origin "pull/$NUM/head" && git checkout -qf FETCH_HEAD); then
    echo "[poller] PR #$NUM: could not check out head; skipping this tick"
    continue
  fi
  # Overlay the review harness from origin/main: the PR must not be able to
  # edit its own reviewer (T12), and old branches may predate the harness.
  if ! (git restore --source=origin/main --staged --worktree --no-overlay -- scripts/review scripts/delivery/phase-events.mjs scripts/verify/risk-tiers.yml REVIEW.md .claude/lenses &&
        git clean -qfdx -- scripts/review .claude/lenses); then
    echo "[poller] PR #$NUM: trusted harness restoration failed; skipping this tick"
    continue
  fi
  case "$STATE" in success|failure)
    if ! CURRENT_IDENTITY="$(bash scripts/review/run-review.sh "$NUM" --identity)"; then
      echo "[poller] PR #$NUM: current review-input identity unavailable; no verdict reuse"
      for CONTEXT in lens/correctness review/round; do
        "$GH_BIN" api "repos/{owner}/{repo}/statuses/$SHA" -f state=error -f context="$CONTEXT" -f description='execution/input_identity: independent review identity unavailable' >/dev/null || true
      done
      continue
    fi
    CURRENT_KEY="$(printf '%s' "$CURRENT_IDENTITY" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["cache_key"])')" || continue
    PRIOR_DESCRIPTION="$(printf '%s' "$STATUS_ROWS" | jq -r '[.[] | select(.context == "review/round")] | sort_by(.created_at,.id) | last | .description // ""')"
    case "$PRIOR_DESCRIPTION" in "round-key:$CURRENT_KEY "*) continue ;; esac
    CURRENT_DOMAINS="$(printf '%s' "$CURRENT_IDENTITY" | python3 -I -c 'import json,sys; print(" ".join(json.load(sys.stdin)["domains"]))')" || continue
    for CONTEXT in $(printf 'lens/%s\n' $CURRENT_DOMAINS) review/round; do
      "$GH_BIN" api "repos/{owner}/{repo}/statuses/$SHA" -f state=pending -f context="$CONTEXT" -f description='review inputs changed: replacement complete round required' >/dev/null || continue 2
    done
    echo "[poller] PR #$NUM: review inputs changed; one complete round required" ;;
  esac
  FITSY_REVIEW_TIMEOUT_SECONDS="$ATTEMPT_TIMEOUT" \
    bash scripts/review/run-review.sh "$NUM" || echo "[poller] PR #$NUM review round -> fail"
  # Reconcile once after the round, including concurrent or failed closeouts.
  TIMING_ROOT="$REPO_DIR/.evidence/review-delivery/$NUM"
  if [ -f "$TIMING_ROOT/.evidence/delivery/binding.json" ]; then
    (cd "$TIMING_ROOT" && node "$REPO_DIR/scripts/delivery/phase-events.mjs" publish) || echo "[poller] PR #$NUM timing publication pending"
  fi
  git checkout -qf origin/main 2>/dev/null || true
  git clean -qfd 2>/dev/null || true
done
echo "[poller] done"
