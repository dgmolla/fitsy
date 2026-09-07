#!/usr/bin/env bash
# T5 / testing-strategy: mock only external services, never your own code.
# The external boundary (legitimately mockable): apps/api/services/* wrappers
# and lib/supabase (the Supabase SDK edge). Everything else in our tree is our
# code. Shadow while existing offenders migrate to the DB-container tests
# (apps/api/tests/db/, autoship step 6b).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
# any jest.mock of a non-node_modules module (starts with @/, ./ or ../) ...
ALL="$(grep -rn --include='*.test.ts' --include='*.test.tsx' -E "jest\.mock\((\"|')(@/|\.{1,2}/)" apps/api 2>/dev/null || true)"
# ... minus the external boundary (path resolved inside the mock target)
HITS="$(echo "$ALL" | grep -vE "jest\.mock\((\"|')[^\"')]*(lib/supabase|services/)" || true)"
COUNT="$(echo "$HITS" | grep -c . || true)"
if [ -n "$HITS" ] && [ "${COUNT:-0}" -gt 0 ]; then
  echo "$HITS" | head -10 >&2
  printf '{"name":"own-code-mocks","status":"fail","summary":"%s own-code jest.mock() calls in apps/api tests","fix":"test against the DB container instead of mocking our own code; the external boundary (services/*, lib/supabase) stays mockable"}\n' "$COUNT"
  exit 1
fi
printf '{"name":"own-code-mocks","status":"pass","summary":"no own-code mocks (services/* and lib/supabase are the mockable boundary)","fix":""}\n'
