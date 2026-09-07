#!/usr/bin/env bash
# Mutation score on the core pure-logic modules (T5, shadow). Scheduled/local
# only: a full run costs minutes even incrementally; per-PR gating waits until
# the score and runtime stabilize (autoship rollout step 10 ratchet).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
mkdir -p .evidence/mutation
if npx stryker run 2>&1 | tee .evidence/mutation/last-run.log | tail -20 >&2; then
  SCORE="$(python3 -c 'import json;d=json.load(open(".evidence/mutation/report.json"));f=d["files"];k=[m for v in f.values() for m in v["mutants"]];killed=sum(1 for m in k if m["status"] in ("Killed","Timeout"));valid=sum(1 for m in k if m["status"] not in ("Ignored","CompileError"));print(round(100*killed/valid,1) if valid else 0)' 2>/dev/null || echo "?")"
  printf '{"name":"mutation","status":"pass","summary":"mutation score %s%% (break threshold 50)","fix":""}\n' "$SCORE"
else
  printf '{"name":"mutation","status":"fail","summary":"mutation score under the break threshold","fix":"open .evidence/mutation/last-run.log; surviving mutants list the exact line and operator - add an assertion that kills each"}\n'
  exit 1
fi
