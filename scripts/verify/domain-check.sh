#!/usr/bin/env bash
# Report the domains in a PR without splitting a coherent outcome by layer.
# Use the reviewed routing table and fail closed when comparison is unavailable.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT" || exit 1
fail_context() {
  printf '{"name":"domain-check","status":"fail","summary":"Unable to resolve PR files and head","fix":"fetch the comparison history and retry with GitHub access"}\n'
  exit 1
}
COMPARE_HEAD=HEAD
if [ -n "${PR_NUMBER:-}" ]; then
  COMPARE_HEAD="$(gh pr view "$PR_NUMBER" --json headRefOid --jq .headRefOid 2>/dev/null)" || fail_context
  [[ "$COMPARE_HEAD" =~ ^[a-f0-9]{40}$ ]] || fail_context
fi
# Git provides every file at the pinned revision, without an API page limit.
CHANGED="$(git diff --name-only "origin/main...$COMPARE_HEAD" 2>/dev/null)" || fail_context
if [ -z "$CHANGED" ]; then
  printf '{"name":"domain-check","status":"skipped","summary":"no diff vs origin/main","fix":""}\n'
  exit 2
fi
# Classify removal-only exception maintenance with the same changed product files.
CHANGED="$(printf '%s\n' "$CHANGED" | node scripts/verify/domain-allowlist-paths.mjs "$COMPARE_HEAD")"
# Read the reviewed routing table at the same revision when the PR changes it.
ROUTING_HEAD=origin/main
if echo "$CHANGED" | grep -q '^scripts/route-reviewers.sh$'; then
  ROUTING_HEAD="$COMPARE_HEAD"
fi
ROUTING_FILE="$(mktemp)" || fail_context
trap 'rm -f "$ROUTING_FILE"' EXIT
git show "$ROUTING_HEAD:scripts/route-reviewers.sh" > "$ROUTING_FILE" 2>/dev/null || fail_context
RESULT="$(echo "$CHANGED" | bash "$ROUTING_FILE")" || fail_context
UNIQUE="$(echo "$RESULT" | tr -d '[]"' | tr ',' '\n' | sed '/^$/d' | sort -u | tr '\n' ' ' | xargs)"
COUNT="$(echo "$UNIQUE" | wc -w | xargs)"
echo "domains: $UNIQUE" >&2
if [ "$COUNT" -gt 1 ]; then
  printf '{"name":"domain-check","status":"pass","summary":"PR touches %s domains: %s","fix":"Confirm one coherent outcome, one owner, and acceptance evidence across the changed layers"}\n' "$COUNT" "$UNIQUE"
  exit 0
fi
printf '{"name":"domain-check","status":"pass","summary":"single domain: %s","fix":""}\n' "$UNIQUE"
