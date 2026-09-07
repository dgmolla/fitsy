#!/usr/bin/env bash
# Kept for muscle memory; the registry runner is the implementation.
exec bash "$(dirname "$0")/verify/run.sh" --layer=0-1 --scope=changed --runs=local
