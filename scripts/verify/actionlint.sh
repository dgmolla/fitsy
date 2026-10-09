#!/usr/bin/env bash
# Workflow files are tier-high attack surface; lint them (shellcheck included).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
BIN="$(command -v actionlint || true)"
if [ -z "$BIN" ] || ! command -v shellcheck >/dev/null; then
  printf '{"name":"actionlint","status":"fail","summary":"actionlint and shellcheck are required before verification","fix":"install both tools before cheap checks and independent review"}\n'
  exit 1
fi
if "$BIN" >&2; then
  printf '{"name":"actionlint","status":"pass","summary":"workflows lint clean","fix":""}\n'
else
  printf '{"name":"actionlint","status":"fail","summary":"workflow lint errors","fix":"actionlint output above names file:line; fix the expression/shell issue it describes"}\n'
  exit 1
fi
