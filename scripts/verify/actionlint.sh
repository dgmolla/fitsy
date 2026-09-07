#!/usr/bin/env bash
# Workflow files are tier-high attack surface; lint them (shellcheck included).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
BIN="$(command -v actionlint || true)"
[ -z "$BIN" ] && [ -x /usr/local/bin/actionlint ] && BIN=/usr/local/bin/actionlint
if [ -z "$BIN" ]; then
  printf '{"name":"actionlint","status":"skipped","summary":"actionlint not installed","fix":"brew install actionlint (CI installs it in the static job)"}\n'
  exit 2
fi
if "$BIN" >&2; then
  printf '{"name":"actionlint","status":"pass","summary":"workflows lint clean","fix":""}\n'
else
  printf '{"name":"actionlint","status":"fail","summary":"workflow lint errors","fix":"actionlint output above names file:line; fix the expression/shell issue it describes"}\n'
  exit 1
fi
