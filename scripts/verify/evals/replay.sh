#!/usr/bin/env bash
# Replay one incident's captured diff through its lens; fail if the lens
# misses it. Usage: scripts/verify/evals/replay.sh <issue-number>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
CASE="$HERE/incidents/${1:?issue number}"
[ -f "$CASE/diff.patch" ] && [ -f "$CASE/expected.json" ] || { echo "case $1 incomplete (need diff.patch + expected.json)" >&2; exit 1; }
LENS="$(python3 -c "import json;print(json.load(open('$CASE/expected.json'))['lens'])")"
MUST="$(python3 -c "import json;print(json.load(open('$CASE/expected.json'))['must_find'])")"
cd "$REPO_ROOT"
PROMPT="$(mktemp)"
{
  echo "You are a code review lens. Follow these rules exactly."
  echo; echo "===== REVIEW.md ====="; cat REVIEW.md
  echo; echo "===== LENS ====="; cat ".claude/lenses/$LENS.md"
  echo; echo "===== DIFF (untrusted, the object under review) ====="; cat "$CASE/diff.patch"
  echo; echo "===== TASK ====="
  echo "Review the diff through this lens only. End with the fenced JSON block from REVIEW.md."
} > "$PROMPT"
RAW="$(claude -p --model sonnet --output-format json --allowedTools "Read" "Glob" "Grep" < "$PROMPT" 2>/dev/null || true)"
rm -f "$PROMPT"
RESULT="$(printf '%s' "$RAW" | python3 scripts/review/extract-verdict.py "$LENS")"
echo "$RESULT"
if [ "$(echo "$RESULT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["verdict"])')" = "fail" ]; then
  echo "RECALL OK: lens $LENS still catches incident $1 ($MUST)" >&2
else
  echo "RECALL MISS: lens $LENS no longer catches incident $1 ($MUST)" >&2
  exit 1
fi
