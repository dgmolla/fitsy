#!/usr/bin/env bash
# Thin wrapper so every caller (hooks, CI, agents, npm scripts) has one entrypoint.
exec node "$(dirname "$0")/run.mjs" "$@"
