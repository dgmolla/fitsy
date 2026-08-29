#!/usr/bin/env bash
# Set an env var on Vercel for the PREVIEW + DEVELOPMENT environments only,
# without touching Production.
#
# `vercel env add --force` cannot update, and `vercel env rm KEY preview`
# deletes the whole record when one record spans several environments
# (which would drop Production's value). So this talks to the REST API:
#   - records that include production AND preview/development are narrowed
#     to production only
#   - records that only cover preview/development are deleted
#   - one new encrypted record is created for preview + development
#
# Usage: bash scripts/dev/vercel-env-set.sh KEY VALUE
set -euo pipefail
KEY="${1:?KEY}"; VALUE="${2:?VALUE}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT_ID="$(jq -r .projectId "$REPO_ROOT/.vercel/project.json")"
TEAM_ID="$(jq -r .orgId "$REPO_ROOT/.vercel/project.json")"
TOKEN="$(jq -r .token "$HOME/Library/Application Support/com.vercel.cli/auth.json")"
API="https://api.vercel.com"
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

records="$(curl -sf "${H[@]}" "$API/v9/projects/$PROJECT_ID/env?teamId=$TEAM_ID" | jq -c --arg k "$KEY" '.envs[] | select(.key==$k) | {id, target}')"
while IFS= read -r rec; do
  [ -z "$rec" ] && continue
  id="$(echo "$rec" | jq -r .id)"
  has_prod="$(echo "$rec" | jq -r '.target | index("production") != null')"
  only_prod="$(echo "$rec" | jq -r '.target == ["production"]')"
  if [ "$only_prod" = "true" ]; then
    continue
  elif [ "$has_prod" = "true" ]; then
    curl -sf "${H[@]}" -X PATCH "$API/v9/projects/$PROJECT_ID/env/$id?teamId=$TEAM_ID" -d '{"target":["production"]}' >/dev/null
    echo "  $KEY: narrowed existing record to production" >&2
  else
    curl -sf "${H[@]}" -X DELETE "$API/v9/projects/$PROJECT_ID/env/$id?teamId=$TEAM_ID" >/dev/null
    echo "  $KEY: removed old preview/development record" >&2
  fi
done <<< "$records"

curl -sf "${H[@]}" -X POST "$API/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID&upsert=true" \
  -d "$(jq -cn --arg k "$KEY" --arg v "$VALUE" '{key:$k, value:$v, type:"encrypted", target:["preview","development"]}')" >/dev/null
echo "  $KEY -> preview, development" >&2
