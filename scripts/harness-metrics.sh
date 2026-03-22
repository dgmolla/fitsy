#!/bin/bash
# Harness Metrics — Measure harness effectiveness
# Run via: bash scripts/harness-metrics.sh [days]
# Default: last 7 days

set -e

DAYS=${1:-7}
SINCE=$(date -v-${DAYS}d +%Y-%m-%d 2>/dev/null || date -d "${DAYS} days ago" +%Y-%m-%d)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Harness Metrics (last ${DAYS} days, since ${SINCE}) ==="
echo ""

BOT_AUTHORS="harness-bot|claude|bot@harness"

echo "--- Agent Task Completion Rate ---"
AGENT_PRS_MERGED=$(gh pr list --state merged --search "created:>=${SINCE}" --json number --jq 'length' 2>/dev/null || echo "0")
HUMAN_INTERVENTION=0
if [ "$AGENT_PRS_MERGED" -gt 0 ]; then
  for PR_NUM in $(gh pr list --state merged --search "created:>=${SINCE}" --json number --jq '.[].number' 2>/dev/null); do
    NON_BOT_COMMITS=$(gh pr view "$PR_NUM" --json commits \
      --jq "[.commits[].authors[].login // .commits[].authors[].name] | map(select(test(\"${BOT_AUTHORS}\") | not)) | length" 2>/dev/null || echo "0")
    if [ "$NON_BOT_COMMITS" -gt 0 ]; then HUMAN_INTERVENTION=$((HUMAN_INTERVENTION + 1)); fi
  done
  COMPLETED=$((AGENT_PRS_MERGED - HUMAN_INTERVENTION))
  RATE=$((COMPLETED * 100 / AGENT_PRS_MERGED))
  echo "  Merged: $AGENT_PRS_MERGED | Autonomous: $COMPLETED | Rate: ${RATE}% (target: >80%)"
else
  echo "  No merged PRs in this period"
  RATE=0
fi
echo ""

echo "--- CI First-Run Pass Rate ---"
TOTAL_PRS=0; FIRST_RUN_PASS=0
for PR_NUM in $(gh pr list --state all --search "created:>=${SINCE}" --json number --jq '.[].number' 2>/dev/null); do
  TOTAL_PRS=$((TOTAL_PRS + 1))
  FIRST_CHECK=$(gh pr checks "$PR_NUM" --json name,state --jq '[.[].state] | if all(. == "SUCCESS") then "pass" else "fail" end' 2>/dev/null || echo "unknown")
  if [ "$FIRST_CHECK" = "pass" ]; then FIRST_RUN_PASS=$((FIRST_RUN_PASS + 1)); fi
done
if [ "$TOTAL_PRS" -gt 0 ]; then
  CI_RATE=$((FIRST_RUN_PASS * 100 / TOTAL_PRS))
  echo "  Total: $TOTAL_PRS | First-run pass: $FIRST_RUN_PASS | Rate: ${CI_RATE}% (target: >90%)"
else
  echo "  No PRs in this period"
  CI_RATE=0
fi
echo ""

echo "--- Review First-Pass Rate ---"
REVIEWED_PRS=0; FIRST_PASS_APPROVED=0
for PR_NUM in $(gh pr list --state merged --search "created:>=${SINCE}" --json number --jq '.[].number' 2>/dev/null); do
  REVIEWS=$(gh api "repos/{owner}/{repo}/pulls/${PR_NUM}/reviews" --jq '[.[].body // ""] | map(select(test("VERDICT")))' 2>/dev/null || echo "[]")
  REVIEW_COUNT=$(echo "$REVIEWS" | jq 'length' 2>/dev/null || echo "0")
  if [ "$REVIEW_COUNT" -gt 0 ]; then
    REVIEWED_PRS=$((REVIEWED_PRS + 1))
    FIRST_VERDICT=$(echo "$REVIEWS" | jq -r '.[0] // ""' 2>/dev/null || echo "")
    if echo "$FIRST_VERDICT" | grep -qi "VERDICT:.*APPROVE"; then FIRST_PASS_APPROVED=$((FIRST_PASS_APPROVED + 1)); fi
  fi
done
if [ "$REVIEWED_PRS" -gt 0 ]; then
  REVIEW_RATE=$((FIRST_PASS_APPROVED * 100 / REVIEWED_PRS))
  echo "  Reviewed: $REVIEWED_PRS | First-pass: $FIRST_PASS_APPROVED | Rate: ${REVIEW_RATE}% (target: >70%)"
else
  echo "  No reviewed PRs in this period"
  REVIEW_RATE=0
fi
echo ""

echo "--- Reverts ---"
REVERT_COMMITS=$(git -C "$REPO_ROOT" log --oneline --since="$SINCE" main 2>/dev/null | grep -ic "revert" || echo "0")
echo "  Revert commits: $REVERT_COMMITS (target: <1/week)"
echo ""

echo "=== Summary ==="
echo "  Task completion:    ${RATE}%    (>80%)"
echo "  CI first-run:       ${CI_RATE}%    (>90%)"
echo "  Review first-pass:  ${REVIEW_RATE}%    (>70%)"
echo "  Reverts (${DAYS}d):       ${REVERT_COMMITS}      (<1/wk)"

METRICS_LOG="$REPO_ROOT/proj-mgmt/metrics.csv"
if [ ! -f "$METRICS_LOG" ]; then
  echo "date,task_completion,ci_pass_rate,review_pass_rate,reverts" > "$METRICS_LOG"
fi
echo "$(date +%Y-%m-%d),${RATE},${CI_RATE},${REVIEW_RATE},${REVERT_COMMITS}" >> "$METRICS_LOG"
