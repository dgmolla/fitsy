#!/usr/bin/env bash
# T8: PRs stay under 600 changed lines (excluding lockfiles, migrations,
# snapshots, generated files). Big diffs are unreviewable and unrevertable.
# Override: 'override-size' label on the PR, logged as a Layer 10 input.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
LIMIT=600
RANGE="origin/main...HEAD"
git rev-parse origin/main >/dev/null 2>&1 || { printf '{"name":"size-check","status":"skipped","summary":"no origin/main","fix":""}\n'; exit 2; }
LINES=$(git diff "$RANGE" --numstat -- . \
  ':(exclude)package-lock.json' ':(exclude)prisma/migrations/**' \
  ':(exclude)**/__snapshots__/**' ':(exclude)*.snap' ':(exclude).evidence/**' \
  | awk '{a+=$1; d+=$2} END {print a+d+0}')
if [ "$LINES" -le "$LIMIT" ]; then
  printf '{"name":"size-check","status":"pass","summary":"%s changed lines (limit %s)","fix":""}\n' "$LINES" "$LIMIT"
  exit 0
fi
if [ -n "${PR_NUMBER:-}" ] && command -v gh >/dev/null && gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' 2>/dev/null | grep -q '^override-size$'; then
  printf '{"name":"size-check","status":"pass","summary":"%s lines, override-size label present","fix":""}\n' "$LINES"
  exit 0
fi
printf '{"name":"size-check","status":"fail","summary":"%s changed lines exceeds %s","fix":"split into smaller single-purpose PRs; if the size is inherent (a migration, a generated file), add the override-size label with a justification comment"}\n' "$LINES" "$LIMIT"
exit 1
