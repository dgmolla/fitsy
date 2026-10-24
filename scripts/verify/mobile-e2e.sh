#!/usr/bin/env bash
# Hosted diagnostics use an isolated device and the shared impact selection.
# Local native acceptance still belongs to the source-bound product-flow runner.
set -uo pipefail
if [ "${FITSY_RUNS:-}" = ci ]; then
  exec node "$(dirname "$0")/../sim/ci.mjs" "$@"
fi
printf '{"name":"mobile-e2e","status":"skipped","summary":"unscoped legacy native smoke retired to avoid shared Maestro driver collisions","fix":"run the required source-bound product-flow runner with the exact owned UDID; see docs/engineering/devops/shipping.md"}\n'
exit 2
