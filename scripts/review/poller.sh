#!/usr/bin/env bash
# Local review runner: find open PRs whose head commit lacks a lens status and
# run the appropriate lens. Installed as a LaunchAgent by install-poller.sh;
# also runnable by hand. Reviews on the Max subscription (no API billing).
#
# Runs in its own clone (~/.fitsy-review/repo) so it never touches a working
# tree an agent or human is editing.
set -uo pipefail
REVIEW_HOME="${FITSY_REVIEW_HOME:-$HOME/.fitsy-review}"
REPO_DIR="$REVIEW_HOME/repo"
LOG="$REVIEW_HOME/poller.log"
mkdir -p "$REVIEW_HOME"
exec >>"$LOG" 2>&1
echo "[poller] $(date -u +%FT%TZ) tick"

if [ ! -d "$REPO_DIR/.git" ]; then
  gh repo clone dgmolla/fitsy "$REPO_DIR" -- --quiet || { echo "[poller] clone failed"; exit 0; }
fi
cd "$REPO_DIR"
git fetch -q origin && git checkout -qf origin/main 2>/dev/null

gh pr list --state open --json number,headRefOid --limit 20 --jq '.[] | "\(.number) \(.headRefOid)"' |
while read -r NUM SHA; do
  # tier decides the lens: low (docs/bookkeeping) -> docs-sanity, else correctness
  TIER="$(gh pr view "$NUM" --json files --jq '.files[].path' | node scripts/review/tier.mjs)"
  LENS=$([ "$TIER" = "low" ] && echo docs-sanity || echo correctness)
  # skip if this head commit already has the lens status
  HAVE="$(gh api "repos/{owner}/{repo}/commits/$SHA/statuses" --jq "[.[] | select(.context==\"lens/$LENS\")] | length" 2>/dev/null || echo 0)"
  if [ "${HAVE:-0}" -gt 0 ]; then continue; fi
  echo "[poller] reviewing PR #$NUM ($LENS) at ${SHA:0:7}"
  # check out the PR head so the lens reads the branch's actual file context;
  # fail closed: reviewing against stale context is worse than waiting a tick
  if ! (git fetch -q origin "pull/$NUM/head" && git checkout -qf FETCH_HEAD); then
    echo "[poller] PR #$NUM: could not check out head; skipping this tick"
    continue
  fi
  bash scripts/review/run-lens.sh "$NUM" "$LENS" || echo "[poller] PR #$NUM lens/$LENS -> fail"
  git checkout -qf origin/main 2>/dev/null || true
done
echo "[poller] done"
