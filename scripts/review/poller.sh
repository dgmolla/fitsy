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
cd "$REPO_DIR"
git fetch -q origin && git checkout -qf origin/main 2>/dev/null

"$GH_BIN" pr list --state open --json number,headRefOid --limit 20 --jq '.[] | "\(.number) \(.headRefOid)"' |
while read -r NUM SHA; do
  # tier decides the lens: low (docs/bookkeeping) -> docs-sanity, else correctness
  FILES_FOR_TIER="$("$GH_BIN" pr view "$NUM" --json files --jq '.files[].path')"
  TIER="$(echo "$FILES_FOR_TIER" | node scripts/review/tier.mjs)"
  LABELS="$("$GH_BIN" pr view "$NUM" --json labels --jq '.labels[].name')"
  BODY="$("$GH_BIN" pr view "$NUM" --json body --jq '.body // ""')"
  if [ "$TIER" = "low" ]; then LENSES="docs-sanity"; else LENSES="correctness"; fi
  [ "$TIER" = "high" ] && LENSES="$LENSES danger-zone"
  # exact label match, not substring (a future "incident-followup" label must not trigger)
  echo "$LABELS" | grep -qx incident && LENSES="$LENSES harness-audit"
  # spec-conformance runs when the PR declares a spec
  echo "$BODY" | grep -qiE '^spec:' && LENSES="$LENSES spec-conformance"
  FILES="$FILES_FOR_TIER"
  echo "$FILES" | grep -qE '^(\.github/|vercel\.json|apps/mobile/eas\.json|scripts/deploy/)' && LENSES="$LENSES workflow-security"
  echo "$FILES" | grep -qE '\.test\.(ts|tsx)$' && LENSES="$LENSES test-quality"
  # Only a completed verdict closes the lens. An execution error is retried on
  # a later tick, subject to review-budget.py's existing attempt/time limits.
  PENDING=""
  for L in $LENSES; do
    STATE="$("$GH_BIN" api "repos/{owner}/{repo}/commits/$SHA/statuses" 2>/dev/null |
      jq -r --arg lens "lens/$L" -f scripts/review/poller-status.jq 2>/dev/null || true)"
    case "$STATE" in
      success|failure) ;;
      *) PENDING="$PENDING $L" ;;
    esac
  done
  [ -n "$PENDING" ] || continue
  echo "[poller] reviewing PR #$NUM (${PENDING# }) at ${SHA:0:7}"
  # Check out the PR head so the lens reads the branch's actual file context;
  # fail closed: reviewing against stale context is worse than waiting a tick.
  if ! (git fetch -q origin "pull/$NUM/head" && git checkout -qf FETCH_HEAD); then
    echo "[poller] PR #$NUM: could not check out head; skipping this tick"
    continue
  fi
  # Overlay the review harness from origin/main: the PR must not be able to
  # edit its own reviewer (T12), and old branches may predate the harness.
  git checkout -q origin/main -- scripts/review scripts/verify/risk-tiers.yml REVIEW.md .claude/lenses
  for L in $PENDING; do
    FITSY_REVIEW_BUDGET_LEDGER="${FITSY_REVIEW_BUDGET_LEDGER:-$REVIEW_HOME/budgets/$NUM.jsonl}" \
      bash scripts/review/run-lens.sh "$NUM" "$L" || echo "[poller] PR #$NUM lens/$L -> fail"
  done
  git checkout -qf origin/main 2>/dev/null || true
  git clean -qfd 2>/dev/null || true
done
echo "[poller] done"
