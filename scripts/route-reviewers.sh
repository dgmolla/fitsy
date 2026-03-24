#!/bin/bash
# Route changed files to reviewing agents.
# Single source of truth — workflow and structural test read from this.
#
# Usage: echo "apps/api/foo.ts" | bash scripts/route-reviewers.sh
# Output: JSON array, e.g. ["backend","cto"]

set -euo pipefail

CHANGED=$(cat)
# Exclude auto-generated files — not domain code
CHANGED=$(echo "$CHANGED" | grep -v 'package-lock\.json$')
AGENTS=""

# Root-level config files are CTO infrastructure
if echo "$CHANGED" | grep -qE '^(package\.json|tsconfig\.json|\.nvmrc|\.env[^/]*)$'; then
  AGENTS="$AGENTS cto"
fi

# Prisma schema is CTO infrastructure (data model design)
if echo "$CHANGED" | grep -qE '^prisma/'; then
  AGENTS="$AGENTS cto"
fi

# Per-package config files for API and shared workspace packages → CTO infrastructure
# BEGIN ROUTING TABLE
if echo "$CHANGED" | grep -qE '^(apps/api|packages/shared)/(package\.json|tsconfig\.json|next\.config\..*)$'; then
  AGENTS="$AGENTS cto"
fi

# Mobile app config files (package.json, tsconfig.json, app.config.ts) → frontend
# app.config.ts is Expo-specific and owned by the frontend team
if echo "$CHANGED" | grep -qE '^apps/mobile/(package\.json|tsconfig\.json|app\.config\..*)$'; then
  AGENTS="$AGENTS frontend"
fi

# Backend: actual source code in api source directories                      -> backend
if echo "$CHANGED" | grep -qE '^apps/api/(app|lib|services)/'; then
  AGENTS="$AGENTS backend"
fi

# Shared package src — co-owned by backend and frontend; route to backend    -> backend
# (frontend becomes co-owner once mobile source code exists)
if echo "$CHANGED" | grep -qE '^packages/shared/src/'; then
  AGENTS="$AGENTS backend"
fi

# Frontend: actual source code in mobile source directories                  -> frontend
if echo "$CHANGED" | grep -qE '^apps/mobile/(app|components|lib)/'; then
  AGENTS="$AGENTS frontend"
fi

# docs/design/                                                                -> designer
if echo "$CHANGED" | grep -qE '^docs/design/'; then
  AGENTS="$AGENTS designer"
fi

# docs/product/ proj-mgmt/                                                   -> product-manager
if echo "$CHANGED" | grep -qE '^(docs/product/|proj-mgmt/)'; then
  AGENTS="$AGENTS product-manager"
fi

# docs/gtm/                                                                   -> gtm
if echo "$CHANGED" | grep -qE '^docs/gtm/'; then
  AGENTS="$AGENTS gtm"
fi

# docs/engineering/backend/ is backend-owned spec territory                  -> backend
if echo "$CHANGED" | grep -qE '^docs/engineering/backend/'; then
  AGENTS="$AGENTS backend"
fi

# .github/ .claude/ scripts/ CLAUDE.md docs/engineering/ (excl. backend/)   -> cto
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
