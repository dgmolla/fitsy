#!/usr/bin/env bash
# T14: context files must not lie. Every `npm run X` and repo path mentioned
# in a CLAUDE.md or FEATURE_MAP must exist; a stale pointer misleads every
# future zero-context author.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
FILES="CLAUDE.md apps/api/CLAUDE.md apps/mobile/CLAUDE.md scripts/CLAUDE.md apps/mobile/FEATURE_MAP.md"
BAD=""
for f in $FILES; do
  [ -f "$f" ] || { BAD="$BAD missing:$f"; continue; }
  # npm run <script> mentions must exist in some package.json
  for scr in $(grep -ohE 'npm run [a-z0-9:_-]+' "$f" | sed -E 's/npm run //' | sort -u); do
    grep -qs "\"$scr\"" package.json apps/*/package.json packages/*/package.json scripts/package.json || BAD="$BAD $f->npm-run:$scr"
  done
  # bare `npm test -w <ws>` validates the workspace exists
  for ws in $(grep -ohE 'npm test -w [@A-Za-z0-9/_-]+' "$f" | sed -E 's/npm test -w //' | sort -u); do
    grep -qs "\"name\": \"$ws\"" apps/*/package.json packages/*/package.json scripts/package.json || BAD="$BAD $f->workspace:$ws"
  done
  # repo-relative script/dir paths in backticks must exist
  for pth in $(grep -ohE '`(scripts|apps|packages|prisma|docs)/[A-Za-z0-9_./-]+`' "$f" | tr -d '\`' | sort -u); do
    CLEAN="${pth%/}"
    [ -e "$CLEAN" ] || BAD="$BAD $f->path:$CLEAN"
  done
done
if [ -n "$BAD" ]; then
  printf '{"name":"context-freshness","status":"fail","summary":"stale context references:%s","fix":"update the named CLAUDE.md/FEATURE_MAP line, or restore the file it points to - context files are load-bearing (T14)"}\n' "$(echo $BAD | head -c 400)"
  exit 1
fi
printf '{"name":"context-freshness","status":"pass","summary":"context files reference only real commands and paths","fix":""}\n'
