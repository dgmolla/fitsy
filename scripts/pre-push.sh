#!/usr/bin/env bash
# Pre-push gate — run locally before git push to catch CI failures early.
# Usage: bash scripts/pre-push.sh
# Install as a git hook: git config core.hooksPath .githooks

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Pre-push gate ==="

# 1. Structural tests (fast, always run)
echo "--- Structural tests ---"
bash scripts/structural-tests.sh

# 2. TypeScript type check (only if tsconfig exists)
if [ -f apps/api/tsconfig.json ]; then
  echo "--- TypeScript: apps/api ---"
  (cd apps/api && npx tsc --noEmit)
fi

if [ -f apps/mobile/tsconfig.json ]; then
  echo "--- TypeScript: apps/mobile ---"
  (cd apps/mobile && npx tsc --noEmit)
fi

# 3. Lint (only if script defined)
if [ -f package.json ] && node -e "require('./package.json').scripts.lint" 2>/dev/null; then
  echo "--- Lint ---"
  npm run lint
fi

echo ""
echo "=== Pre-push gate passed ==="
