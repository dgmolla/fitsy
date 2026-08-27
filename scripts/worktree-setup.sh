#!/usr/bin/env bash
#
# worktree-setup.sh - make a fresh git worktree fully runnable.
#
# A worktree checks out tracked files only, so it is missing two things that are
# gitignored in the primary clone:
#   1. node_modules  - symlinked from the primary (instant; no per-worktree install).
#   2. .env* files    - COPIED from the primary. This is the one that bites: without
#      EXPO_PUBLIC_SUPABASE_URL etc., lib/supabase.ts throws at module load, which
#      cascades into an Expo Router "+not-found" redirect loop on a blank screen.
#      That failure looks like a native / path / dependency problem but is just
#      missing env.
#
# With both in place, `npm run dev:mobile` runs the app in the simulator from the
# worktree normally (serve on a free port and connect a dev client). Only rebuild
# a dev client when native deps / the Expo SDK change.
#
# USAGE (run once per new worktree, from anywhere inside it):
#   bash scripts/worktree-setup.sh
#
set -euo pipefail

WT_ROOT="$(git rev-parse --show-toplevel)"
PRIMARY="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"

if [ "$WT_ROOT" = "$PRIMARY" ]; then
  echo "This is the primary clone ($PRIMARY); nothing to set up."
  exit 0
fi
if [ ! -d "$PRIMARY/node_modules" ]; then
  echo "error: primary clone has no node_modules - run 'npm install' in $PRIMARY first." >&2
  exit 1
fi

echo "Primary clone : $PRIMARY"
echo "This worktree : $WT_ROOT"
echo

# 1. Symlink node_modules (instant, no drift).
for sub in "" "apps/mobile" "apps/api" "packages/shared"; do
  prefix="${sub:+$sub/}"
  src="$PRIMARY/${prefix}node_modules"
  dst="$WT_ROOT/${prefix}node_modules"
  [ -d "$src" ] || continue
  rm -rf "$dst"
  ln -sfn "$src" "$dst"
  echo "  linked ${sub:-<root>}/node_modules"
done

# 2. Copy env files (gitignored -> not in the checkout). THIS is what makes the
#    app actually boot.
copied=0
while IFS= read -r rel; do
  mkdir -p "$WT_ROOT/$(dirname "$rel")"
  cp "$PRIMARY/$rel" "$WT_ROOT/$rel"
  echo "  copied $rel"
  copied=$((copied + 1))
done < <(cd "$PRIMARY" && find . -name ".env*" ! -name "*.example" -not -path "*/node_modules/*" 2>/dev/null | sed 's|^\./||')

echo
echo "Done - node_modules linked, $copied env file(s) copied."
echo "Run the app from this worktree on a free port, e.g.:"
echo "    (cd apps/mobile && npx expo start --dev-client --port 8082)"
