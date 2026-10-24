#!/usr/bin/env bash
# A rollback hold is durable GitHub issue state, shared by CI and local release.
set -euo pipefail
REPO=dgmolla/fitsy
TITLE='release: iOS OTA rollback hold'
MODE="${1:?check|open}"
# Avoid eventually consistent issue search. Read every page of open releases.
HOLDS="$(gh api --paginate --slurp "repos/$REPO/issues?state=open&labels=release&per_page=100" | python3 -c 'import json,sys
pages=json.load(sys.stdin)
assert isinstance(pages,list) and all(isinstance(p,list) for p in pages)
print(",".join(str(x["number"]) for p in pages for x in p if x.get("title")==sys.argv[1] and not x.get("pull_request")))' "$TITLE")"
case "$MODE" in
  check)
    if [ -n "$HOLDS" ]; then echo "iOS OTA held by rollback issue(s): $HOLDS"; exit 2; fi
    ;;
  open)
    if [ -n "$HOLDS" ]; then echo "existing iOS rollback hold: $HOLDS"; else
      gh issue create --repo "$REPO" --label release --title "$TITLE" \
        --body "**TL;DR:** Automatic iOS OTA is held during rollback recovery.

Rollback target: ${2:?group-id required}.
Keep this issue open while diagnosing and repairing the mobile source.
Close this hold only after the repaired mobile source has passed its required checks and independent review and is explicitly approved for production publication.
Every local and CI production OTA checks this durable hold; unrelated main pushes must not restore the rolled-back bundle."
    fi
    ;;
  *) echo 'usage: ota-hold.sh check|open [group-id]' >&2; exit 1 ;;
esac
