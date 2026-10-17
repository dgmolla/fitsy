#!/usr/bin/env bash
# Production build of the API; catches what tests miss. Asserts the build
# leaves no compiled output in the source tree.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
export POSTGRES_PRISMA_URL="${POSTGRES_PRISMA_URL:-postgresql://placeholder:placeholder@localhost:5432/placeholder}"
export POSTGRES_URL_NON_POOLING="${POSTGRES_URL_NON_POOLING:-postgresql://placeholder:placeholder@localhost:5432/placeholder}"
export GOOGLE_PLACES_API_KEY="${GOOGLE_PLACES_API_KEY:-placeholder}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-placeholder}"
if [ -n "${FITSY_BUILD_HEAP_MIB+x}" ]; then
  if [[ ! "$FITSY_BUILD_HEAP_MIB" =~ ^[1-9][0-9]*$ ]]; then
    printf '{"name":"build","status":"fail","summary":"invalid FITSY_BUILD_HEAP_MIB","fix":"set a positive integer MiB or leave it unset"}\n'
    exit 1
  fi
fi
run_build() {
  if [ -n "${FITSY_BUILD_HEAP_MIB+x}" ]; then
    /usr/bin/env "NODE_OPTIONS=--max-old-space-size=$FITSY_BUILD_HEAP_MIB" npm run build:api -- -- --no-lint
  else
    npm run build:api -- -- --no-lint
  fi
}
if ! run_build >&2; then
  printf '{"name":"build","status":"fail","summary":"next build failed","fix":"run: npm run build:api -- -- --no-lint locally; the build error names the module"}\n'
  exit 1
fi
if git status --porcelain | grep -E '\.(js|js\.map)$' | grep -v node_modules >&2; then
  printf '{"name":"build","status":"fail","summary":"build wrote .js files into the source tree","fix":"add the emitted paths to .gitignore or fix the tsconfig outDir"}\n'
  exit 1
fi
printf '{"name":"build","status":"pass","summary":"API builds clean, no stray output","fix":""}\n'
