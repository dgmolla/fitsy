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
# Local and CI writers share the same durable lease with rollback.
# shellcheck source=scripts/deploy/ota-lock.sh
source "$REPO_ROOT/scripts/deploy/ota-lock.sh"
acquire_ota_lock
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' fetch origin main
HEAD_SHA="$(git rev-parse HEAD)"
[ -z "$(git -C "$REPO_ROOT" diff --name-only HEAD origin/main -- apps/mobile packages package.json package-lock.json .npmrc 'babel.config.*' 'metro.config.*')" ] || { echo "Newer mobile inputs exist on main; publish current approved source" >&2; exit 1; }
git rev-list --first-parent origin/main | python3 -c 'import sys; sys.exit(0 if sys.argv[1] in sys.stdin.read().splitlines() else 1)' "$HEAD_SHA" || { echo "Publish only an integrated main-line commit" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Publish only a clean checkout" >&2; exit 1; }
# A rollback holds both local and CI publication until explicit release approval.
HOLD_STATUS=0
bash "$REPO_ROOT/scripts/deploy/ota-hold.sh" check || HOLD_STATUS=$?
if [ "$HOLD_STATUS" -eq 2 ]; then echo "OTA skipped: rollback recovery hold"; exit 0; fi
[ "$HOLD_STATUS" -eq 0 ] || exit "$HOLD_STATUS"
node "$REPO_ROOT/scripts/deploy/native-compatibility.mjs"
# Reconcile against the actual newest production iOS update, not this push's
# diff or the Vercel source. API-only survivors can carry an earlier unapplied
# mobile change, while unchanged mobile inputs must not create duplicate OTAs.
COMMAND_TMP="${TMPDIR:-${RUNNER_TEMP:?owned command temporary directory required}}"
APPLIED_LIST="$(mktemp "$COMMAND_TMP/fitsy-ota-applied-list.XXXXXX")"
APPLIED_VIEW="$(mktemp "$COMMAND_TMP/fitsy-ota-applied-view.XXXXXX")"
env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 update:list --branch production --limit 1 --json --non-interactive > "$APPLIED_LIST"
APPLIED_GROUP="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); rows=d.get("currentPage") or d.get("updates") or [] if isinstance(d,dict) else d; assert len(rows)==1; print(rows[0]["group"])' "$APPLIED_LIST")"
env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 update:view "$APPLIED_GROUP" --json > "$APPLIED_VIEW"
APPLICABLE=0
python3 - "$APPLIED_VIEW" "$APPLIED_GROUP" "$HEAD_SHA" "$REPO_ROOT" <<'PYCODE' || APPLICABLE=$?
import json, re, subprocess, sys
updates = json.load(open(sys.argv[1]))
ios = [row for row in updates if row['platform'] == 'ios' and row['group'] == sys.argv[2]]
assert len(ios) == 1 and not ios[0].get('isRollBackToEmbedded'), 'missing actual production iOS source'
source = ios[0]['gitCommitHash']
assert re.fullmatch('[0-9a-f]{40}', source), 'missing full production update commit'
# A feature parent or absent source cannot establish the currently applied inputs.
main = subprocess.check_output(['git', 'rev-list', '--first-parent', 'origin/main'], text=True, cwd=sys.argv[4]).splitlines()
assert source in main, 'production update source is not known integrated main history'
paths = ['apps/mobile', 'packages', 'package.json', 'package-lock.json', '.npmrc', 'babel.config.*', 'metro.config.*']
changed = subprocess.check_output(['git', 'diff', '--name-only', source, sys.argv[3], '--', *paths], text=True, cwd=sys.argv[4])
if not changed.strip():
    print('OTA not applicable: current production iOS update already has these mobile inputs')
    sys.exit(3)
print('Unapplied mobile inputs:\n' + changed)
PYCODE
rm -f "$APPLIED_LIST" "$APPLIED_VIEW"
[ "$APPLICABLE" -ne 3 ] || exit 0
[ "$APPLICABLE" -eq 0 ] || { echo "Cannot establish production iOS update source; reconcile before publishing" >&2; exit 1; }
env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 env:exec production 'node ../../scripts/deploy/native-compatibility.mjs --production-env' --non-interactive
# No Android production binary has been verified. Never publish Android using
# the iOS proof or infer safety merely from an unchanged appVersion runtime.
mkdir -p "$REPO_ROOT/.evidence/ota"
RESULT="$(mktemp "$REPO_ROOT/.evidence/ota/result.XXXXXX")"
OTA_MUTATION_IN_PROGRESS=1
env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 update --platform ios --branch production --environment production --non-interactive --message "$MSG" --json > "$RESULT"
GROUP="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));d=d[0] if isinstance(d,list) else d;print(d.get("group") or d.get("id",""))' "$RESULT")"
[ -n "$GROUP" ] || { echo "eas update returned no group id" >&2; exit 1; }
echo "update group: $GROUP"
# Verify: the newest update on the production branch must be OUR group.
sleep 5
LATEST="$(env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 update:list --branch production --limit 1 --json --non-interactive | python3 -c 'import json,sys;d=json.load(sys.stdin);u=(d.get("currentPage") or d.get("updates") or d or [{}])[0];print(u.get("group") or u.get("id",""))')"
if [ "$LATEST" != "$GROUP" ]; then
  echo "VERIFY FAILED: newest production update is $LATEST, expected $GROUP" >&2
  exit 1
fi
BUNDLE_RECEIPT="$(mktemp "$REPO_ROOT/.evidence/ota/bundle.XXXXXX")"
python3 "$REPO_ROOT/scripts/deploy/ota-bundle-identity.py" "$GROUP" > "$BUNDLE_RECEIPT"
OTA_MUTATION_IN_PROGRESS=0
echo "verified: production branch serves group $GROUP. Roll back with: scripts/deploy/rollback.sh mobile"
