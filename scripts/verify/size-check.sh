#!/usr/bin/env bash
# Report the review-size signal without imposing a line-count split on a
# coherent outcome. Exclude lockfiles, migrations, snapshots and evidence.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT" || exit 1
LIMIT=600
RANGE="origin/main...HEAD"
git rev-parse origin/main >/dev/null 2>&1 || { printf '{"name":"size-check","status":"skipped","summary":"no origin/main","fix":""}\n'; exit 2; }
LINES=$(git diff "$RANGE" --numstat -- . \
  ':(exclude)package-lock.json' ':(exclude)prisma/migrations/**' \
  ':(exclude)**/__snapshots__/**' ':(exclude)*.snap' ':(exclude).evidence/**' \
  | awk '{a+=$1; d+=$2} END {print a+d+0}')
if [ "$LINES" -gt "$LIMIT" ]; then
  printf '{"name":"size-check","status":"pass","summary":"%s changed lines exceeds the %s-line review signal","fix":"Confirm one coherent outcome and complete acceptance evidence; split only independently useful slices"}\n' "$LINES" "$LIMIT"
else
  printf '{"name":"size-check","status":"pass","summary":"%s changed lines (review signal %s)","fix":""}\n' "$LINES" "$LIMIT"
fi
