#!/usr/bin/env bash
# Publish the mobile JS bundle as a production OTA update.
# Hard-won invariants baked in (see memory/incidents 2026-09-01):
#   - ALWAYS --environment production, or the bundle ships keyless and the
#     paywall breaks ("Plans are still loading")
#   - verify the newest production update group matches what we just published
#     (group-id check; the keyless-bundle class is prevented by the hardcoded
#     --environment flag above, not detected after the fact)
# Usage: scripts/deploy/ota.sh "<message>"
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT/apps/mobile"
MSG="${1:-$(git log -1 --format='%h: %s')}"
# Source checks run before export. Production env checks also compare the
# environment-dependent Google scheme to the actual processed iOS binary.
# A queued mobile push remains publishable when a later API-only push advances
# main. Require a main-line commit, excluding unmerged feature-branch parents,
# rather than equality with a remote ref that can advance during deployment.
HEAD_SHA="$(git rev-parse HEAD)"
git rev-list --first-parent origin/main | python3 -c 'import sys; sys.exit(0 if sys.argv[1] in sys.stdin.read().splitlines() else 1)' "$HEAD_SHA" || { echo "Publish only an integrated main-line commit" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Publish only a clean checkout" >&2; exit 1; }
node "$REPO_ROOT/scripts/deploy/native-compatibility.mjs"
npx eas-cli@18 env:exec production 'node ../../scripts/deploy/native-compatibility.mjs --production-env' --non-interactive
# No Android production binary has been verified. Never publish Android using
# the iOS proof or infer safety merely from an unchanged appVersion runtime.
mkdir -p "$REPO_ROOT/.evidence/ota"
RESULT="$(mktemp "$REPO_ROOT/.evidence/ota/result.XXXXXX")"
npx eas-cli@18 update --platform ios --branch production --environment production --non-interactive --message "$MSG" --json > "$RESULT"
GROUP="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));d=d[0] if isinstance(d,list) else d;print(d.get("group") or d.get("id",""))' "$RESULT")"
[ -n "$GROUP" ] || { echo "eas update returned no group id" >&2; exit 1; }
echo "update group: $GROUP"
# Verify: the newest update on the production branch must be OUR group.
sleep 5
LATEST="$(npx eas-cli@18 update:list --branch production --limit 1 --json --non-interactive | python3 -c 'import json,sys;d=json.load(sys.stdin);u=(d.get("currentPage") or d.get("updates") or d or [{}])[0];print(u.get("group") or u.get("id",""))')"
if [ "$LATEST" != "$GROUP" ]; then
  echo "VERIFY FAILED: newest production update is $LATEST, expected $GROUP" >&2
  exit 1
fi
echo "verified: production branch serves group $GROUP. Roll back with: scripts/deploy/rollback.sh mobile"
