#!/usr/bin/env bash
# Explicit administrator operation; never invoked by CI.
set -euo pipefail
repo=${1:?Usage: apply-branch-protection.sh OWNER/REPO}
endpoint="repos/$repo/branches/main/protection"
protected=$(gh api "repos/$repo/branches/main" --jq .protected)
current='{}'
if [[ "$protected" != false ]]; then current=$(gh api "$endpoint"); fi
app=$(gh api apps/github-actions --jq .id)
payload=$(jq --argjson app "$app" '
  def actors: {users: [.users[]?.login], teams: [.teams[]?.slug], apps: [.apps[]?.slug]};
  . as $old |
  {required_linear_history, required_conversation_resolution, block_creations, lock_branch, allow_fork_syncing}
  | map_values(.enabled // false) | . + {
    required_status_checks: {strict: true, contexts: [], checks: (
      ($old.required_status_checks | (.checks // []) +
        [.contexts[]? as $name | select(all(.checks[]?; .context != $name)) | {context: $name}])
      | map({context, app_id: (.app_id // -1)})
      | map(if .context == "Verify" and .app_id == -1 then .app_id = $app else . end)
      | . + [{context: "Verify", app_id: $app}] | unique_by([.context, .app_id]))},
    enforce_admins: true,
    required_pull_request_reviews: ($old.required_pull_request_reviews // {} | del(.url) | . + {
      dismiss_stale_reviews: true, require_code_owner_reviews: false, require_last_push_approval: false,
      required_approving_review_count: (.required_approving_review_count // 0),
      bypass_pull_request_allowances: {users: [], teams: [], apps: []}}
      | if .dismissal_restrictions then .dismissal_restrictions |= actors else del(.dismissal_restrictions) end),
    restrictions: ($old.restrictions | if . == null then null else actors end),
    allow_force_pushes: false, allow_deletions: false
  }
' <<<"$current")
gh api --method PUT "$endpoint" --input - <<<"$payload"
gh api --method PATCH "repos/$repo" -F allow_auto_merge=true --silent
gh api "$endpoint"
gh api "repos/$repo" --jq '{allow_auto_merge}'
