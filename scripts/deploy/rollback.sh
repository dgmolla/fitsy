#!/usr/bin/env bash
# One-command rollback (T9). Rollback first, diagnosis second.
#   scripts/deploy/rollback.sh api      # promote the previous READY production deployment
#   scripts/deploy/rollback.sh mobile   # roll the production update branch back one group
set -euo pipefail
cd "$(dirname "$0")/../.."
SURFACE="${1:?api|mobile}"
case "$SURFACE" in
  api)
    # ONE-SHOT: after a rollback the second-newest READY deployment is the one
    # you just replaced; pass an explicit URL for anything beyond the first:
    #   rollback.sh api [deployment-url]
    [ -f .vercel/project.json ] || { echo "run from a Vercel-linked clone (missing .vercel/project.json)" >&2; exit 1; }
    if [ -n "${2:-}" ]; then
      PREV="$2"
    else
      # previous READY production deployment, via the API (vercel ls has no
      # reliable state filter). Ids duplicated from .vercel/project.json for a
      # zero-parse one-liner; the guard above keeps them honest. Token path is
      # macOS (the local runner is the designated break-glass host).
      TOKEN="$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/Library/Application Support/com.vercel.cli/auth.json")))["token"])')"
      PREV="$(curl -sf -H "Authorization: Bearer $TOKEN" \
        "https://api.vercel.com/v6/deployments?projectId=prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4&teamId=team_VVc52BrZfx5IT2B1mDI5AuPT&target=production&state=READY&limit=2" \
        | python3 -c 'import sys,json;d=json.load(sys.stdin)["deployments"];print("https://"+d[1]["url"] if len(d)>1 else "")')"
    fi
    : "${PREV:?could not find a previous READY production deployment}"
    echo "promoting previous production deployment: $PREV"
    vercel promote "$PREV" --yes --scope dawits-projects-74b6e00f
    curl -s -o /dev/null -w 'fitsy.org/api/health -> %{http_code}\n' https://fitsy.org/api/health
    ;;
  mobile)
    cd apps/mobile
    # Republish an older update group (update:rollback is interactive-only).
    # ONE-SHOT semantics: after a rollback, list[1] is the bad bundle you just
    # replaced - a blind second invocation would re-ship it. Pass the group
    # explicitly for anything beyond the first rollback:
    #   rollback.sh mobile [group-id]
    EXPLICIT="${2:-}"
    mkdir -p ../../.evidence/ota
    UPDATE_LIST="$(mktemp ../../.evidence/ota/rollback-list.XXXXXX)"
    env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 update:list --branch production --limit 20 --json --non-interactive > "$UPDATE_LIST"
    python3 -c 'import json,sys
u=json.load(open(sys.argv[1]))
u=u.get("currentPage") or u.get("updates") or u
for i,x in enumerate(u):
    print("  [%d] %s %s" % (i, x["group"], x.get("message","")[:60]))' "$UPDATE_LIST"
    PREV_GROUP="$EXPLICIT"
    # Establish the hold before waiting; selection occurs under the shared lease.
    bash ../../scripts/deploy/ota-hold.sh open "${PREV_GROUP:-automatic distinct iOS bundle selection}"
    source ../../scripts/deploy/ota-lock.sh
    acquire_ota_lock
    if [ -z "$PREV_GROUP" ]; then
      env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 update:list --branch production --limit 20 --json --non-interactive > "$UPDATE_LIST"
      IOS_GROUP_IDS="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));u=d.get("currentPage") or d.get("updates") or d
for x in u:
    if "ios" in x.get("platforms", "").lower() and not x.get("isRollBackToEmbedded"):
        print(x["group"])' "$UPDATE_LIST")"
      CURRENT_IDENTITY=""
      while IFS= read -r GROUP; do
        [ -n "$GROUP" ] || continue
        IDENTITY="$(python3 ../../scripts/deploy/ota-bundle-identity.py "$GROUP" --identity-only)"
        if [ -z "$CURRENT_IDENTITY" ]; then CURRENT_IDENTITY="$IDENTITY"; continue; fi
        if [ "$IDENTITY" != "$CURRENT_IDENTITY" ]; then PREV_GROUP="$GROUP"; break; fi
      done <<< "$IOS_GROUP_IDS"
      : "${PREV_GROUP:?no verified distinct prior iOS bundle; keep hold open and supply an explicit known-good group}"
    fi
    OTA_MUTATION_IN_PROGRESS=1
    RESULT="$(mktemp ../../.evidence/ota/rollback-result.XXXXXX)"
    # Match the verified production release surface; no Android binary is
    # established by the iOS compatibility receipt.
    env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 update:republish --platform ios --group "$PREV_GROUP" --message "rollback: republish $PREV_GROUP" --json --non-interactive > "$RESULT"
    RECOVERY_GROUP="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));d=d[0] if isinstance(d,list) else d;print(d["group"])' "$RESULT")"
    LATEST="$(env -u GH_TOKEN -u GITHUB_TOKEN npx eas-cli@18 update:list --branch production --limit 1 --json --non-interactive | python3 -c 'import json,sys;d=json.load(sys.stdin);u=d.get("currentPage") or d.get("updates") or d;print(u[0]["group"])')"
    [ "$LATEST" = "$RECOVERY_GROUP" ] || { echo 'Recovery group is not newest; release lease retained' >&2; exit 1; }
    OTA_MUTATION_IN_PROGRESS=0
    echo "republished group $PREV_GROUP; verify, then open an incident issue"
    ;;
  *) echo "usage: rollback.sh api|mobile" >&2; exit 1 ;;
esac
echo "NOW: open an incident issue (gh issue create --label incident) with the deploy sha and what broke."
