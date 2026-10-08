#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Review sees committed source. Ignored evidence/configuration stays subject to
# verification/product receipts rather than being mistaken for reviewed code.
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo '{"name":"review-admission","status":"fail","summary":"candidate source is not frozen and committed","fix":"finish edits, commit, run cheap/focused checks and canonical review"}'
  exit 1
fi
if ! bash scripts/review/run-review.sh --local --cached-only >&2; then
  echo '{"name":"review-admission","status":"fail","summary":"no current passing source-bound independent review","fix":"run cheap/focused checks and one canonical run-review.sh --local round; repair blocking findings"}'
  exit 1
fi
echo '{"name":"review-admission","status":"pass","summary":"canonical exact-head review permits full acceptance","fix":""}'
