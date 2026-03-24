#!/bin/bash
# Route changed files to reviewing agents.
# Single source of truth — workflow and structural test read from this.
#
# Usage: echo "apps/api/foo.ts" | bash scripts/route-reviewers.sh
# Output: JSON array, e.g. ["backend","cto"]

set -euo pipefail

CHANGED=$(cat)
AGENTS=""

# BEGIN ROUTING TABLE
# apps/api/ prisma/ packages/shared/                                      -> backend
if echo "$CHANGED" | grep -qE '^(apps/api/|prisma/|packages/shared/)'; then
  AGENTS="$AGENTS backend"
fi

# apps/mobile/                                                            -> frontend
if echo "$CHANGED" | grep -qE '^apps/mobile/'; then
  AGENTS="$AGENTS frontend"
fi

# docs/design/                                                            -> designer
if echo "$CHANGED" | grep -qE '^docs/design/'; then
  AGENTS="$AGENTS designer"
fi

# docs/product/ proj-mgmt/okrs                                            -> product-manager
if echo "$CHANGED" | grep -qE '^(docs/product/|proj-mgmt/okrs)'; then
  AGENTS="$AGENTS product-manager"
fi

# docs/gtm/                                                               -> gtm
if echo "$CHANGED" | grep -qE '^docs/gtm/'; then
  AGENTS="$AGENTS gtm"
fi

# .github/ .claude/ scripts/ CLAUDE.md docs/engineering/adrs/ docs/engineering/devops/ -> cto
if echo "$CHANGED" | grep -qE '^(\.github/|\.claude/|scripts/|CLAUDE\.md|docs/engineering/(adrs|devops)/)'; then
  AGENTS="$AGENTS cto"
fi
# END ROUTING TABLE

# Fallback: if no specific agent matched, CTO reviews
if [ -z "$AGENTS" ]; then
  AGENTS="cto"
fi

# Deduplicate, remove empty strings, output JSON array
# Uses pure bash to avoid jq dependency for local testing
UNIQUE=$(echo "$AGENTS" | tr ' ' '\n' | sed '/^$/d' | sort -u)
JSON="["
FIRST=true
while IFS= read -r agent; do
  [ -z "$agent" ] && continue
  if [ "$FIRST" = true ]; then
    JSON="${JSON}\"${agent}\""
    FIRST=false
  else
    JSON="${JSON},\"${agent}\""
  fi
done <<< "$UNIQUE"
JSON="${JSON}]"
echo "$JSON"
