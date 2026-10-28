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
SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/fitsy-build-source.XXXXXX")" || exit 1
trap 'rm -f "$SNAPSHOT"' EXIT
check_source_output() {
  python3 - "$SNAPSHOT" "$1" <<'PY'
import hashlib, json, pathlib, subprocess, sys
paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).decode().split('\0')
current = {name: hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()
           for name in set(paths) if name.endswith(('.js', '.js.map'))
           and 'node_modules' not in pathlib.Path(name).parts and pathlib.Path(name).is_file()}
snapshot = pathlib.Path(sys.argv[1])
if sys.argv[2] == 'before':
    snapshot.write_text(json.dumps(current))
else:
    before = json.loads(snapshot.read_text())
    changed = sorted(name for name in before.keys() | current.keys() if before.get(name) != current.get(name))
    for name in changed:
        print(name, file=sys.stderr)
    sys.exit(1 if changed else 0)
PY
}
if ! check_source_output before; then
  printf '{"name":"build","status":"fail","summary":"cannot snapshot JavaScript source","fix":"run from an ordinary readable Git checkout"}\n'
  exit 1
fi
if ! run_build >&2; then
  printf '{"name":"build","status":"fail","summary":"next build failed","fix":"run: npm run build:api -- -- --no-lint locally; the build error names the module"}\n'
  exit 1
fi
if ! check_source_output after; then
  printf '{"name":"build","status":"fail","summary":"build changed JavaScript source or emitted files","fix":"inspect the named paths; fix code generation or the tsconfig outDir"}\n'
  exit 1
fi
printf '{"name":"build","status":"pass","summary":"API builds clean, no stray output","fix":""}\n'
