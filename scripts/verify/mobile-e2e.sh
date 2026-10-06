#!/usr/bin/env bash
# Legacy shadow smoke is diagnostic only; native execution belongs to the
# source-bound product-flow runner with an explicit owned simulator UDID.
set -uo pipefail
printf '{"name":"mobile-e2e","status":"skipped","summary":"unscoped legacy native smoke retired to avoid shared Maestro driver collisions","fix":"run the required source-bound product-flow runner with the exact owned UDID; see docs/engineering/devops/shipping.md"}\n'
exit 2
