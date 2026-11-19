#!/usr/bin/env bash
# Fitsy on-call tick (#991). Runs the no-LLM trigger; only when it reports new items does it start one short Claude session.
# A quiet tick spends zero Claude tokens. Install via a launchd job every 5 minutes (not installed by this script).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
log="${ONCALL_LOG:-$HOME/.config/fitsy/oncall.log}"
mkdir -p "$(dirname "$log")"
items="$(node "$here/trigger.mjs" 2>>"$log" || true)"
[ -n "$items" ] || exit 0
printf '%s tick: new items\n' "$(date -u +%FT%TZ)" >>"$log"
printf '%s\n' "$items" | claude -p --model "${ONCALL_MODEL:-sonnet}" "$(cat "$here/prompt.md")" >>"$log" 2>&1
