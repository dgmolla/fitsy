#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node scripts/verify/product-flow.mjs
