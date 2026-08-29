#!/bin/bash
# Route changed files to reviewing agents.
# Single source of truth — workflow and structural test read from this.
#
# Usage: echo "apps/api/foo.ts" | bash scripts/route-reviewers.sh
# Output: JSON array, e.g. ["backend","cto"]

set -euo pipefail

CHANGED=$(cat)
# Exclude auto-generated and bookkeeping files — not domain code
# '|| true': grep exits 1 when all lines are filtered; don't let set -e abort
CHANGED=$(echo "$CHANGED" | grep -v 'package-lock\.json$' || true)
CHANGED=$(echo "$CHANGED" | grep -v '^proj-mgmt/sprints/' || true)
AGENTS=""
# Documentation-only agents. Docs that ship alongside code are reviewed with
# that code (the reviewer reads the docs as part of the diff); they only route
# to their own domain when the PR is docs-only. See
# docs/engineering/devops/autonomous-shipping.md, Layer 1.
DOC_AGENTS=""

# Root-level config files are CTO infrastructure
if echo "$CHANGED" | grep -qE '^(package\.json|tsconfig\.json|\.nvmrc|\.env[^/]*)$'; then
  AGENTS="$AGENTS cto"
fi

# Prisma schema is owned by backend (schema changes ship with API changes)
if echo "$CHANGED" | grep -qE '^prisma/'; then
  AGENTS="$AGENTS backend"
fi

# BEGIN ROUTING TABLE
# E2E tests under apps/api/tests/e2e/ are cross-domain — CTO reviews      -> cto
if echo "$CHANGED" | grep -qE '^apps/api/tests/e2e/'; then
  AGENTS="$AGENTS cto"
fi

# All of apps/api/ except e2e tests                                        -> backend
if echo "$CHANGED" | grep -vE '^apps/api/tests/e2e/' | grep -qE '^apps/api/'; then
  AGENTS="$AGENTS backend"
fi

# All of apps/mobile/                                                         -> frontend
if echo "$CHANGED" | grep -qE '^apps/mobile/'; then
  AGENTS="$AGENTS frontend"
fi

# packages/shared/ — workspace config → cto; src/ → backend
if echo "$CHANGED" | grep -qE '^packages/shared/(package\.json|tsconfig\.json)$'; then
  AGENTS="$AGENTS cto"
fi
if echo "$CHANGED" | grep -qE '^packages/shared/src/'; then
  AGENTS="$AGENTS backend"
fi

# docs/design/                                                                -> designer
if echo "$CHANGED" | grep -qE '^docs/design/'; then
  DOC_AGENTS="$DOC_AGENTS designer"
fi

# docs/product/ proj-mgmt/                                                   -> product-manager
if echo "$CHANGED" | grep -qE '^proj-mgmt/'; then
  AGENTS="$AGENTS product-manager"
fi
if echo "$CHANGED" | grep -qE '^docs/product/'; then
  DOC_AGENTS="$DOC_AGENTS product-manager"
fi

# docs/gtm/                                                                   -> gtm
if echo "$CHANGED" | grep -qE '^docs/gtm/'; then
  DOC_AGENTS="$DOC_AGENTS gtm"
fi

# docs/engineering/backend/ is backend-owned spec territory                  -> backend
if echo "$CHANGED" | grep -qE '^docs/engineering/backend/'; then
  DOC_AGENTS="$DOC_AGENTS backend"
fi

# Preload pipeline scripts (data ingestion) are backend-owned               -> backend
# Route them before the general scripts/ rule so they don't double-count
if echo "$CHANGED" | grep -qE '^scripts/(preload|rescrape|reestimate|rerun|pipeline-utils|pipeline-events|pipeline-report|pipeline-completed-hex|retry|axiom-setup|hex-grid|hex-assignment|hex-persist|hex-resume|checkpoint|semaphore|overture-discovery|mini-hex-e2e|jest\.config)'; then
  AGENTS="$AGENTS backend"
fi

# .github/ .claude/ scripts/ CLAUDE.md docs/engineering/adrs/ devops/       -> cto
# Pipeline scripts already matched as backend above
if echo "$CHANGED" | grep -vE '^scripts/(preload|rescrape|reestimate|rerun|pipeline-utils|pipeline-events|pipeline-report|pipeline-completed-hex|retry|axiom-setup|hex-grid|hex-assignment|hex-persist|hex-resume|checkpoint|semaphore|overture-discovery|mini-hex-e2e|jest\.config)' | grep -qE '^(\.github/|\.claude/|scripts/|CLAUDE\.md)'; then
  AGENTS="$AGENTS cto"
fi
if echo "$CHANGED" | grep -qE '^docs/engineering/(adrs|devops)/'; then
  DOC_AGENTS="$DOC_AGENTS cto"
fi
# END ROUTING TABLE

# Docs-only agents count only when nothing else matched.
if [ -z "$(echo "$AGENTS" | xargs)" ]; then
  AGENTS="$DOC_AGENTS"
fi

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
