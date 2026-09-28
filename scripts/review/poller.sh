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
git fetch -q origin && git checkout -qf origin/main 2>/dev/null

"$GH_BIN" pr list --state open --json number,headRefOid --limit 20 --jq '.[] | "\(.number) \(.headRefOid)"' |
while read -r NUM SHA; do
  # Every change gets one correctness review, including docs, tests and specs.
  # Specialists are reserved for changed production risk and release controls.
  FILES_FOR_TIER="$("$GH_BIN" pr view "$NUM" --json files --jq '.files[].path')"
  LENSES="correctness"
  DANGER=0; WORKFLOW=0
  while IFS= read -r FILE; do
    case "$FILE" in
      REVIEW.md|.claude/lenses/*|docs/engineering/devops/shipping.md) WORKFLOW=1; continue ;;
    esac
    case "$FILE" in
      ''|docs/*|proj-mgmt/*|*.md|*.mdx|*.test.*|*.spec.*|*.fixture.*|*/__mocks__/*|apps/mobile/e2e/*) continue ;;
    esac
    case "$FILE" in
      apps/api/lib/auth*|apps/api/lib/subscription*|apps/api/services/auth*|apps/api/services/revenuecat*|apps/api/app/api/auth/*|apps/api/app/api/revenuecat/*|apps/api/app/api/subscriptions/*|apps/mobile/app/auth/*|apps/mobile/app/welcome/payment*|apps/mobile/components/*Auth*|apps/mobile/components/*Paywall*|apps/mobile/components/*Payment*|apps/mobile/lib/*Auth*|apps/mobile/lib/*Purchas*|apps/mobile/lib/*paywall*|apps/mobile/lib/*purchase*|prisma/schema.prisma|prisma/migrations/*) DANGER=1 ;;
    esac
    case "$FILE" in
      .github/workflows/*|scripts/deploy/*|scripts/review/*.sh|scripts/review/*.py|scripts/review/*.mjs|scripts/review/*.jq|scripts/verify/*.sh|scripts/verify/*.mjs|scripts/sim/publish-product-flow.mjs|vercel.json|apps/mobile/eas.json|apps/mobile/app.config.ts) WORKFLOW=1 ;;
    esac
  done <<< "$FILES_FOR_TIER"
  [ "$DANGER" = 0 ] || LENSES="$LENSES danger-zone"
  [ "$WORKFLOW" = 0 ] || LENSES="$LENSES workflow-security"
  # An incomplete execution gets one later retry; the raw statuses and budget
  # history remain, and a second failure requires independent coordination.
  PENDING=""
  for L in $LENSES; do
    if ! STATUS_ROWS="$("$GH_BIN" api "repos/{owner}/{repo}/commits/$SHA/statuses?per_page=100" 2>/dev/null)"; then
      echo "[poller] PR #$NUM: status read failed; skipping this tick"
      PENDING=""; break
    fi
    if ! printf '%s' "$STATUS_ROWS" | jq -e 'type == "array"' >/dev/null 2>&1; then
      echo "[poller] PR #$NUM: invalid status response; skipping this tick"
      PENDING=""; break
    fi
    STATE="$(printf '%s' "$STATUS_ROWS" | jq -r --arg lens "lens/$L" -f scripts/review/poller-status.jq 2>/dev/null || true)"
    case "$STATE" in
      success|failure) ;;
      *)
        ERRORS="$(printf '%s' "$STATUS_ROWS" | jq -r --arg lens "lens/$L" '[.[] | select(.context == $lens and .state == "error")] | length' 2>/dev/null || echo 0)"
        if [ "$STATE" = error ] && [ "$ERRORS" -ge 2 ]; then
          "$GH_BIN" api "repos/{owner}/{repo}/statuses/$SHA" -f state=failure -f context="lens/$L" \
            -f description='needs-coordinator: independent review incomplete after one retry' >/dev/null || \
            echo "[poller] PR #$NUM lens/$L: coordinator status publication failed"
          echo "[poller] PR #$NUM lens/$L: needs-coordinator; raw incomplete attempts retained"
        else PENDING="$PENDING $L"; fi ;;
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
  git checkout -q origin/main -- scripts/review scripts/delivery/phase-events.mjs scripts/verify/risk-tiers.yml REVIEW.md .claude/lenses
  for L in $PENDING; do
    FITSY_REVIEW_TIMEOUT_SECONDS="${FITSY_REVIEW_TIMEOUT_SECONDS:-300}" \
      bash scripts/review/run-lens.sh "$NUM" "$L" || echo "[poller] PR #$NUM lens/$L -> fail"
  done
  # Reconcile once after all lenses, including concurrent or failed closeouts.
  TIMING_ROOT="$REPO_DIR/.evidence/review-delivery/$NUM"
  if [ -f "$TIMING_ROOT/.evidence/delivery/binding.json" ]; then
    (cd "$TIMING_ROOT" && node "$REPO_DIR/scripts/delivery/phase-events.mjs" publish) || echo "[poller] PR #$NUM timing publication pending"
  fi
  git checkout -qf origin/main 2>/dev/null || true
  git clean -qfd 2>/dev/null || true
done
echo "[poller] done"
