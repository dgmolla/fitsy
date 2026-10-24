#!/usr/bin/env bash
# Kept for muscle memory; use the same checks as Git's hook.
exec /bin/bash -p "$(dirname "$0")/../.githooks/pre-push" "$@"
