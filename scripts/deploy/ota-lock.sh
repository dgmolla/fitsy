#!/usr/bin/env bash
# Source this file to serialize local/CI publication and operator rollback.
# GitHub creates a ref atomically; its unique commit identifies the lease owner.
OTA_LOCK_REPO=dgmolla/fitsy
OTA_LOCK_NAME=tags/fitsy-ios-ota-lock
OTA_MUTATION_IN_PROGRESS=0
release_ota_lock() {
  local current
  current="$(gh api "repos/$OTA_LOCK_REPO/git/ref/$OTA_LOCK_NAME" --jq .object.sha)" || return 1
  [ "$current" = "$OTA_LOCK_OWNER" ] || { echo 'Refusing to delete another release lease' >&2; return 1; }
  gh api --method DELETE "repos/$OTA_LOCK_REPO/git/refs/$OTA_LOCK_NAME"
}
acquire_ota_lock() {
  local main tree attempt existing
  main="$(gh api "repos/$OTA_LOCK_REPO/git/ref/heads/main" --jq .object.sha)"
  tree="$(gh api "repos/$OTA_LOCK_REPO/git/commits/$main" --jq .tree.sha)"
  OTA_LOCK_OWNER="$(gh api --method POST "repos/$OTA_LOCK_REPO/git/commits" \
    -f tree="$tree" -f message="iOS release lease $(python3 -c 'import uuid;print(uuid.uuid4())')" --jq .sha)"
  [[ "$OTA_LOCK_OWNER" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid release lease identity' >&2; return 1; }
  for attempt in $(seq 1 360); do
    if gh api --method POST "repos/$OTA_LOCK_REPO/git/refs" \
      -f ref="refs/$OTA_LOCK_NAME" -f sha="$OTA_LOCK_OWNER" >/dev/null 2>&1; then
      trap 'status=$?; trap - EXIT; if [ "$OTA_MUTATION_IN_PROGRESS" = 1 ]; then echo "Release lease retained: reconcile uncertain EAS mutation before unlocking" >&2; status=1; else release_ota_lock || status=1; fi; exit "$status"' EXIT
      trap 'trap - EXIT; echo "Release lease retained after interruption" >&2; exit 130' INT TERM HUP
      return 0
    fi
    existing="$(gh api "repos/$OTA_LOCK_REPO/git/ref/$OTA_LOCK_NAME" --jq .object.sha)" || { echo 'Cannot acquire or read the release lease' >&2; return 1; }
    [[ "$existing" =~ ^[a-f0-9]{40}$ ]] || return 1
    echo "Waiting for active iOS release lease ($attempt/360)"
    sleep 5
  done
  echo 'Release lease still active; reconcile its owner before retrying' >&2
  return 1
}
