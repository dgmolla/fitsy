#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if node scripts/deploy/env-manifest.mjs; then
  printf '{"name":"env-manifest","status":"pass","summary":"all environment reads are declared","fix":""}\n'
else
  printf '{"name":"env-manifest","status":"fail","summary":"unlisted environment reads","fix":"declare variables and required targets in scripts/deploy/env-manifest.json; never include values"}\n'
  exit 1
fi
