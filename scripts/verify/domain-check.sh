#!/usr/bin/env bash
# Single-domain PR enforcement via scripts/route-reviewers.sh (main's copy, so
# PR branches never need a rebase to pick up routing fixes). Moved from
# reviewer.yml. Runs on the PR diff (PR_NUMBER env) or origin/main...HEAD.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
CHANGED=""
if [ -n "${PR_NUMBER:-}" ] && command -v gh >/dev/null; then
  CHANGED="$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null || true)"
fi
[ -z "$CHANGED" ] && CHANGED="$(git diff --name-only origin/main...HEAD 2>/dev/null || true)"
if [ -z "$CHANGED" ]; then
  printf '{"name":"domain-check","status":"skipped","summary":"no diff vs origin/main","fix":""}\n'
  exit 2
fi
# Main's routing table, so PR branches never need a rebase to pick up routing
# fixes — EXCEPT when the PR itself changes the table: that change is under
# review in this very PR (structural test 10 keeps it synced with reviewer.md).
if echo "$CHANGED" | grep -q '^scripts/route-reviewers.sh$'; then
  cp scripts/route-reviewers.sh /tmp/route-reviewers.sh
else
  git show origin/main:scripts/route-reviewers.sh > /tmp/route-reviewers.sh 2>/dev/null || cp scripts/route-reviewers.sh /tmp/route-reviewers.sh
fi
RESULT="$(echo "$CHANGED" | bash /tmp/route-reviewers.sh)"
UNIQUE="$(echo "$RESULT" | tr -d '[]"' | tr ',' '\n' | sed '/^$/d' | sort -u | tr '\n' ' ' | xargs)"
COUNT="$(echo "$UNIQUE" | wc -w | xargs)"
echo "domains: $UNIQUE" >&2
if [ "$COUNT" -gt 1 ]; then
  printf '{"name":"domain-check","status":"fail","summary":"PR touches %s domains: %s","fix":"split into per-domain PRs (routing table: scripts/route-reviewers.sh)"}\n' "$COUNT" "$UNIQUE"
  exit 1
fi
printf '{"name":"domain-check","status":"pass","summary":"single domain: %s","fix":""}\n' "$UNIQUE"
