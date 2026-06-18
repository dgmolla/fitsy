#!/bin/bash
# Structural Tests — Architectural Constraint Enforcement
# Run via: bash scripts/structural-tests.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

SOURCE_DIRS=(
  "$REPO_ROOT/apps/api"
  "$REPO_ROOT/apps/mobile"
  "$REPO_ROOT/packages/shared"
  "$REPO_ROOT/scripts"
)

echo "=== Structural Tests ==="
echo ""

echo -n "1. No hardcoded secrets... "
SECRETS=$(grep -rn --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
  -E '(sk_test_|sk_live_|pk_test_|pk_live_|PRIVATE_KEY=|API_KEY=.*[a-zA-Z0-9]{20,})' \
  "${SOURCE_DIRS[@]}" 2>/dev/null || true)
if [ -n "$SECRETS" ]; then
  echo "FAIL"
  echo "  Hardcoded secrets found. Use environment variables instead."
  echo "$SECRETS" | sed 's/^/  /'
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi

echo -n "2. No hardcoded private IP ranges... "
# Checks for hardcoded internal/private IP ranges that could indicate production
# infrastructure committed to source. localhost is explicitly excluded — it is
# a valid dev fallback (EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').
HARDCODED=$(grep -rn --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
  -E '(192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+|127\.0\.0\.1)' \
  "${SOURCE_DIRS[@]}" 2>/dev/null || true)
if [ -n "$HARDCODED" ]; then
  echo "FAIL"
  echo "  Hardcoded private IPs found. Use environment variables instead."
  echo "$HARDCODED" | sed 's/^/  /'
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi

echo -n "3. No .env files staged... "
ENVFILES=$(git -C "$REPO_ROOT" diff --cached --name-only 2>/dev/null | grep -E '\.env$' | grep -v 'env\.example' || true)
if [ -n "$ENVFILES" ]; then
  echo "FAIL"
  echo "  .env files should not be committed. Add to .gitignore."
  echo "$ENVFILES" | sed 's/^/  /'
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi

MAX_LINES=300
EXEMPT_FILES=("")

echo -n "4. File length limits (<${MAX_LINES} lines)... "
LONG_FILES=""
for dir in "${SOURCE_DIRS[@]}"; do
  while IFS= read -r file; do
    basename=$(basename "$file")
    skip=false
    for exempt in "${EXEMPT_FILES[@]}"; do
      if [ "$basename" = "$exempt" ]; then skip=true; break; fi
    done
    if $skip; then continue; fi
    lines=$(wc -l < "$file")
    if [ "$lines" -gt "$MAX_LINES" ]; then
      LONG_FILES="$LONG_FILES\n  $file: $lines lines"
    fi
  done < <(find "$dir" \( -name "*.ts" -o -name "*.tsx" \) \
    -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.next/*" 2>/dev/null)
done
if [ -n "$LONG_FILES" ]; then
  echo "WARN"
  echo "  Files over $MAX_LINES lines found. Split into smaller modules."
  echo -e "$LONG_FILES"
  # Warning only — not a blocking error. Pre-existing files are grandfathered.
else
  echo "PASS"
fi

echo -n "5. No 'as any' type assertions... "
ANY_TYPES=$(git -C "$REPO_ROOT" diff --cached -U0 --diff-filter=AM -- '*.ts' '*.tsx' 2>/dev/null \
  | grep -n "^+" | grep -v "^+++" | grep "as any\|: any" || true)
if [ -n "$ANY_TYPES" ]; then
  echo "WARN"
  echo "  'any' types in staged changes. Define proper interfaces."
  echo "$ANY_TYPES" | head -5 | sed 's/^/  /'
else
  echo "PASS"
fi

echo -n "6. No console.log in src... "
CONSOLE=$(grep -rn --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
  'console\.log' "${SOURCE_DIRS[@]}" 2>/dev/null || true)
if [ -n "$CONSOLE" ]; then
  echo "WARN"
  echo "  console.log found in source. Use a proper logger."
  echo "$CONSOLE" | head -5 | sed 's/^/  /'
else
  echo "PASS"
fi

echo -n "7. No inline styles... "
INLINE=$(grep -rn --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
  'style={{' "${SOURCE_DIRS[@]}" 2>/dev/null || true)
if [ -n "$INLINE" ]; then
  echo "WARN"
  echo "  Inline styles found. Use Tailwind classes or design system."
  echo "$INLINE" | head -5 | sed 's/^/  /'
else
  echo "PASS"
fi

echo -n "8. No direct API calls outside API layer... "
DIRECT_API=$(grep -rn --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
  -E '(fetch\(|axios\.|\.get\(|\.post\()' "${SOURCE_DIRS[@]}" 2>/dev/null \
  | grep -v 'src/lib/' | grep -v 'src/services/' || true)
if [ -n "$DIRECT_API" ]; then
  echo "WARN"
  echo "  Direct API calls outside lib/services. Use the API layer."
  echo "$DIRECT_API" | head -5 | sed 's/^/  /'
else
  echo "PASS"
fi

ALLOWED_DOCS_DOMAINS="product engineering design gtm"

echo -n "9. Docs directory structure (domain/subdomain)... "
BAD_DOCS=""
if [ -d "$REPO_ROOT/docs" ]; then
  for entry in "$REPO_ROOT/docs"/*/; do
    [ ! -d "$entry" ] && continue
    dirname=$(basename "$entry")
    allowed=false
    for domain in $ALLOWED_DOCS_DOMAINS; do
      if [ "$dirname" = "$domain" ]; then allowed=true; break; fi
    done
    if ! $allowed; then
      BAD_DOCS="$BAD_DOCS\n  docs/$dirname/ is not an allowed domain (allowed: $ALLOWED_DOCS_DOMAINS)"
    fi
  done
  # Check no files directly in docs/ (only dirs). Two exceptions:
  #   - README.md: the docs index (referenced by CLAUDE.md) is allowed at root.
  #   - untracked files: local scratch/planning docs aren't committed, so the
  #     gate only enforces structure on tracked files.
  for entry in "$REPO_ROOT/docs"/*; do
    [ -f "$entry" ] || continue
    fname=$(basename "$entry")
    [ "$fname" = "README.md" ] && continue
    git -C "$REPO_ROOT" ls-files --error-unmatch "docs/$fname" >/dev/null 2>&1 || continue
    BAD_DOCS="$BAD_DOCS\n  $fname is a file directly in docs/ — move it under a domain"
  done
fi
if [ -n "$BAD_DOCS" ]; then
  echo "FAIL"
  echo "  docs/ children must be domain dirs: $ALLOWED_DOCS_DOMAINS"
  echo -e "$BAD_DOCS"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi

echo -n "10. Reviewer routing table matches route-reviewers.sh... "
ROUTE_SCRIPT="$REPO_ROOT/scripts/route-reviewers.sh"
REVIEWER_MD="$REPO_ROOT/.claude/agents/reviewer.md"
if [ -f "$ROUTE_SCRIPT" ] && [ -f "$REVIEWER_MD" ]; then
  # Part A: agent-set check (original)
  # Extract agents from script (comment lines between markers: "-> agent")
  SCRIPT_AGENTS=$(sed -n '/BEGIN ROUTING TABLE/,/END ROUTING TABLE/p' "$ROUTE_SCRIPT" \
    | sed -n 's/.*-> \([a-z-]*\)/\1/p' | sort -u | tr '\n' ' ' | xargs)
  # Extract agents from reviewer.md table (bold agent names between **)
  MD_AGENTS=$(sed -n 's/.*\*\*\([a-z-]*\)\*\*.*/\1/p' "$REVIEWER_MD" \
    | sort -u | tr '\n' ' ' | xargs)
  ROUTING_ERRORS=""
  if [ "$SCRIPT_AGENTS" != "$MD_AGENTS" ]; then
    ROUTING_ERRORS="$ROUTING_ERRORS\n  Agent sets differ:"
    ROUTING_ERRORS="$ROUTING_ERRORS\n    route-reviewers.sh: $SCRIPT_AGENTS"
    ROUTING_ERRORS="$ROUTING_ERRORS\n    reviewer.md:        $MD_AGENTS"
    ROUTING_ERRORS="$ROUTING_ERRORS\n  Update both when adding/removing agents."
  fi

  # Part B: path-to-agent mapping check (extended)
  # Parse each non-header, non-fallback table row from reviewer.md.
  # Row format:  | `path/pattern` | **agentname** |
  # A row may have multiple comma-separated patterns in the path cell.
  # We map each individual pattern to a representative file path for testing.
  #
  # Strategy: strip markdown backtick/bold formatting, split comma-separated
  # path patterns, construct a minimal file path for each, then verify that
  # route-reviewers.sh routes it to the expected agent.
  #
  # Pre-process: replace markdown-escaped pipes (\|) with a placeholder so
  # IFS='|' splitting on the column separator is not confused by \| in patterns.
  while IFS='|' read -r _ path_cell agent_cell _rest; do
    # Skip rows that don't look like data rows (header, separator, empty)
    [[ "$path_cell" =~ ^[[:space:]]*[-:]*[[:space:]]*$ ]] && continue
    [[ "$path_cell" =~ Path[[:space:]]*pattern ]] && continue
    [[ "$path_cell" =~ No[[:space:]]*match ]] && continue
    [[ -z "${path_cell// }" ]] && continue

    # Extract the expected agent name (strip bold markers and whitespace)
    expected_agent=$(echo "$agent_cell" | sed 's/\*\*//g' | xargs)
    [[ -z "$expected_agent" ]] && continue

    # Extract path patterns: strip backticks, parens (regex alternation), whitespace
    # Then split on commas to get individual patterns
    raw_patterns=$(echo "$path_cell" | sed "s/\`//g" | xargs)
    IFS=',' read -ra pattern_list <<< "$raw_patterns"

    for raw_pat in "${pattern_list[@]}"; do
      pat=$(echo "$raw_pat" | xargs)  # trim whitespace
      [[ -z "$pat" ]] && continue

      # Derive a representative file path from the pattern:
      #   - Remove trailing "(all files)" annotation
      #   - If it ends with /, append a dummy filename
      #   - If it contains | (alternation like package.json|tsconfig.json), use first alternative
      #   - If it ends without /, use as-is (exact file path)
      clean_pat=$(echo "$pat" | sed 's/ *(all files)//g' | xargs)
      # Handle alternation groups like packages/shared/(package.json|tsconfig.json)
      # \| was replaced with PIPE_PLACEHOLDER before IFS='|' splitting above
      if echo "$clean_pat" | grep -q '('; then
        # Extract the base before ( and the first alternative inside
        base=$(echo "$clean_pat" | sed 's/(.*//')
        first_alt=$(echo "$clean_pat" | sed 's/.*(\([^PIPE_PLACEHOLDER)]*\).*/\1/')
        clean_pat="${base}${first_alt}"
      fi
      # Handle glob star patterns like proj-mgmt/okrs* — use a concrete filename
      clean_pat=$(echo "$clean_pat" | sed 's/\*$/okrs.md/')
      # If pattern ends with /, append a dummy file
      if [[ "$clean_pat" == */ ]]; then
        probe_path="${clean_pat}foo.ts"
      else
        probe_path="$clean_pat"
      fi

      # Route the probe path and check output contains the expected agent
      actual_json=$(echo "$probe_path" | bash "$ROUTE_SCRIPT" 2>/dev/null)
      if ! echo "$actual_json" | grep -q "\"$expected_agent\""; then
        ROUTING_ERRORS="$ROUTING_ERRORS\n  Path '$probe_path' should route to '$expected_agent' but got: $actual_json"
        ROUTING_ERRORS="$ROUTING_ERRORS\n    (reviewer.md row: $pat → $expected_agent)"
      fi
    done
  done < <(sed 's/\\|/PIPE_PLACEHOLDER/g' "$REVIEWER_MD")

  if [ -n "$ROUTING_ERRORS" ]; then
    echo "FAIL"
    echo -e "$ROUTING_ERRORS"
    echo "  Sync reviewer.md routing table with route-reviewers.sh."
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS"
  fi
else
  echo "SKIP (files not found)"
fi

echo -n "11. Scaffolding completeness (if package.json exists)... "
if [ -f "$REPO_ROOT/package.json" ]; then
  SCAFFOLD_ERRORS=""
  # Must have a lock file
  if [ ! -f "$REPO_ROOT/package-lock.json" ]; then
    SCAFFOLD_ERRORS="$SCAFFOLD_ERRORS\n  Missing package-lock.json — run npm install"
  fi
  # Must have test script
  if ! grep -q '"test"' "$REPO_ROOT/package.json"; then
    SCAFFOLD_ERRORS="$SCAFFOLD_ERRORS\n  Missing \"test\" script in package.json"
  fi
  # Must have build script
  if ! grep -q '"build"' "$REPO_ROOT/package.json"; then
    SCAFFOLD_ERRORS="$SCAFFOLD_ERRORS\n  Missing \"build\" script in package.json"
  fi
  # Must have tsconfig
  if [ ! -f "$REPO_ROOT/tsconfig.json" ] && \
     [ ! -f "$REPO_ROOT/apps/api/tsconfig.json" ] && \
     [ ! -f "$REPO_ROOT/apps/mobile/tsconfig.json" ]; then
    SCAFFOLD_ERRORS="$SCAFFOLD_ERRORS\n  Missing tsconfig.json — TypeScript not configured"
  fi
  # npm ci gate in reviewer workflow must have install step
  if ! grep -q 'npm ci\|npm install' "$REPO_ROOT/.github/workflows/reviewer.yml" 2>/dev/null; then
    SCAFFOLD_ERRORS="$SCAFFOLD_ERRORS\n  reviewer.yml missing npm install step — add it now that package.json exists"
  fi
  if [ -n "$SCAFFOLD_ERRORS" ]; then
    echo "FAIL"
    echo "  package.json exists but scaffolding is incomplete:"
    echo -e "$SCAFFOLD_ERRORS"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS"
  fi
else
  echo "SKIP (no package.json yet)"
fi

echo -n "12. Subscriber-data routes are subscription-gated... "
# Routes under /api/restaurants/ serve subscriber-only data and MUST gate on
# requireSubscription, so the paywall can't be bypassed by hitting the API.
# EXCEPTION — these are intentionally public (used during onboarding, before the
# user subscribes); over-gating them would break the onboarding flow:
RESTAURANTS_API="$REPO_ROOT/apps/api/app/api/restaurants"
PUBLIC_ALLOWLIST=("preview/route.ts" "stats/route.ts")
GATE_ERRORS=""
if [ -d "$RESTAURANTS_API" ]; then
  while IFS= read -r route; do
    rel="${route#"$RESTAURANTS_API"/}"
    is_public=false
    for pub in "${PUBLIC_ALLOWLIST[@]}"; do
      if [ "$rel" = "$pub" ]; then is_public=true; break; fi
    done
    if $is_public; then
      if grep -q 'requireSubscription' "$route"; then
        GATE_ERRORS="$GATE_ERRORS\n  $rel is public (onboarding) but calls requireSubscription — remove the gate or it breaks onboarding"
      fi
    else
      if ! grep -q 'requireSubscription' "$route"; then
        GATE_ERRORS="$GATE_ERRORS\n  $rel serves restaurant data but does NOT call requireSubscription — gate it (or add to PUBLIC_ALLOWLIST if intentionally public)"
      fi
    fi
  done < <(find "$RESTAURANTS_API" -name "route.ts" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null)
fi
if [ -n "$GATE_ERRORS" ]; then
  echo "FAIL"
  echo "  Subscription gating invariant violated:"
  echo -e "$GATE_ERRORS"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS"
fi

echo ""
echo "=== Results ==="
if [ $ERRORS -gt 0 ]; then
  echo "FAILED: $ERRORS blocking violation(s) found."
  exit 1
else
  echo "PASSED: All structural tests passed."
  exit 0
fi
