#!/usr/bin/env bash
# Maestro flows against the booted simulator (autoship L7, deterministic mode).
# Skips (exit 2) when maestro is missing or no simulator is booted with the
# app installed - CI runs this via EAS Workflows, locally it is opt-in.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
command -v maestro >/dev/null || { printf '{"name":"mobile-e2e","status":"skipped","summary":"maestro not installed","fix":"curl -Ls https://get.maestro.mobile.dev | bash"}\n'; exit 2; }
xcrun simctl list devices booted | grep -q Booted || { printf '{"name":"mobile-e2e","status":"skipped","summary":"no simulator booted","fix":"scripts/sim/sim boot, install the dev build, then re-run"}\n'; exit 2; }
FLOWS="apps/mobile/e2e/flows"
[ -d "$FLOWS" ] || { printf '{"name":"mobile-e2e","status":"skipped","summary":"no flows directory","fix":"add flows under apps/mobile/e2e/flows/"}\n'; exit 2; }
mkdir -p .evidence/maestro
if maestro test "$FLOWS" --format junit --output .evidence/maestro/report.xml >&2; then
  printf '{"name":"mobile-e2e","status":"pass","summary":"maestro flows green","fix":""}\n'
else
  printf '{"name":"mobile-e2e","status":"fail","summary":"a maestro flow failed","fix":"open .evidence/maestro/report.xml; screenshots land beside it; fix the flow or the regression it caught"}\n'
  exit 1
fi
