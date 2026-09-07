#!/usr/bin/env bash
# Hardcoded secrets, committed .env files, committed build output.
# Diff-based subchecks use the branch diff (never the staging area, which is
# empty in CI). Moved from ci.yml's security job.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
FAIL=""
# Prefer gitleaks (real ruleset) when installed; the greps below stay as the
# zero-dependency fallback and run either way.
if command -v gitleaks >/dev/null; then
  if ! gitleaks git --no-banner --redact --log-opts="origin/main..HEAD" . >&2 2>&1; then
    FAIL="gitleaks found a secret in the branch commits"
  fi
fi
if grep -rn --include="*.ts" --include="*.tsx" \
    --exclude-dir=node_modules --exclude-dir=discovery-test \
    -E '(ANTHROPIC_API_KEY\s*=\s*"sk-ant|GOOGLE_PLACES_API_KEY\s*=\s*"AIza|FIRECRAWL_API_KEY\s*=\s*"fc-|sk_test_|sk_live_|pk_test_|pk_live_|"-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY)' \
    apps/ packages/ scripts/ >&2 2>/dev/null; then
  FAIL="hardcoded secret pattern found"
fi
CHANGED="$(git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD^ HEAD 2>/dev/null || true)"
# .env, .env.dev, .env.local, ... — anything env-shaped except the example.
# (.env.dev slipped through the exact-match version of this pattern 2026-09-07.)
if echo "$CHANGED" | grep -E '(^|/)\.env(\.[A-Za-z0-9_.-]+)?$' | grep -v '\.env\.example' >&2; then
  FAIL="${FAIL:+$FAIL; }env file committed"
fi
if echo "$CHANGED" | grep -E '\.(js|js\.map)$' | grep -vE '(\.config\.(js|cjs|mjs)|^scripts/)' >&2; then
  FAIL="${FAIL:+$FAIL; }compiled build output committed"
fi
# A worktree's node_modules symlink is a file, which a "node_modules/" ignore
# rule does not match; committed once on 2026-09-07 and broke npm ci everywhere.
if echo "$CHANGED" | grep -E '(^|/)node_modules(/|$)' >&2; then
  FAIL="${FAIL:+$FAIL; }node_modules path committed (worktree symlink?)"
fi
if [ -n "$FAIL" ]; then
  printf '{"name":"secrets","status":"fail","summary":"%s","fix":"move secrets to Vercel env (vercel env add), remove the offending file from the diff, extend .gitignore"}\n' "$FAIL"
  exit 1
fi
printf '{"name":"secrets","status":"pass","summary":"no secrets, env files, or build output in diff","fix":""}\n'
