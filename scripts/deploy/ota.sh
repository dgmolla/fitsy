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
npx eas-cli@18 update --branch production --environment production --non-interactive --message "$MSG" --json > /tmp/ota-result.json
GROUP="$(python3 -c 'import json;d=json.load(open("/tmp/ota-result.json"));d=d[0] if isinstance(d,list) else d;print(d.get("group") or d.get("id",""))')"
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
