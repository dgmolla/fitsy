#!/usr/bin/env bash
# Compatibility entrypoint: every call reviews the complete required round.
# The named domain can only add coverage, never remove routed domains.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:?pr number or --local}"; DOMAIN="${2:?legacy domain name}"
# Required routed domains are already included; the additive argument produces
# the same round cache key as the canonical caller for those domains.
exec bash "$ROOT/scripts/review/run-review.sh" "$TARGET" --add-domain "$DOMAIN"
