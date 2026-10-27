#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)" || exit 1
cd "$REPO_ROOT" || exit 1
node scripts/verify/media-integration.mjs --required >/dev/null
applicability=$?
if [ "$applicability" -eq 2 ]; then
  printf '{"name":"media-integration","status":"pass","applicability":"not_applicable","summary":"no simulator or product-flow controls changed","fix":""}\n'
  exit 0
fi
if [ "$applicability" -ne 0 ]; then
  printf '{"name":"media-integration","status":"fail","summary":"cannot determine media test applicability","fix":"repair Git diff identity and rerun npm run verify"}\n'
  exit 1
fi
# Native process-group fixtures need real ownership observations. Fail before
# launching children when a worker sandbox cannot supply those observations.
if ! ps -axo pid=,ppid=,pgid=,lstart=,command= >/dev/null 2>&1; then
  printf '{"name":"media-integration","status":"fail","summary":"required local process ownership inspection is unavailable","fix":"run the canonical media lane in an authorized host environment with ps access; keep this result failed until then"}\n'
  exit 1
fi
for tool in ffprobe ffmpeg; do
  if ! command -v "$tool" >/dev/null 2>&1 || ! "$tool" -version >/dev/null 2>&1; then
    printf '{"name":"media-integration","status":"fail","summary":"required local ffprobe and ffmpeg are unavailable","fix":"install local FFmpeg tools, then rerun npm run verify"}\n'
    exit 1
  fi
done
if ! FITSY_MEDIA_INTEGRATION=1 npm test --workspace=@fitsy/scripts -- --runInBand --runTestsByPath verify/product-flow.test.ts sim/xctest-attachments.test.ts sim/slack-video.test.ts >&2; then
  printf '{"name":"media-integration","status":"fail","summary":"real-media integration tests failed","fix":"run the named local suites with FFmpeg and fix the failure"}\n'
  exit 1
fi
if ! node scripts/verify/media-integration.mjs --record >&2; then
  printf '{"name":"media-integration","status":"fail","summary":"cannot write source-bound media test receipt","fix":"inspect .evidence/verify and rerun npm run verify"}\n'
  exit 1
fi
printf '{"name":"media-integration","status":"pass","summary":"real-media tests and source-bound receipt passed","fix":""}\n'
