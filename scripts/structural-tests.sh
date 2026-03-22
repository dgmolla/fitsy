#!/bin/bash
# Structural Tests — Architectural Constraint Enforcement
# Run via: bash scripts/structural-tests.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

SOURCE_DIRS=(
  "$REPO_ROOT/src"
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

echo -n "2. No hardcoded URLs/IPs... "
HARDCODED=$(grep -rn --include="*.ts" --include="*.tsx" \
  -E '(192\.168\.|10\.0\.|172\.(1[6-9]|2[0-9]|3[01])\.|localhost:[0-9]|127\.0\.0\.1)' \
  "${SOURCE_DIRS[@]}" 2>/dev/null || true)
if [ -n "$HARDCODED" ]; then
  echo "FAIL"
  echo "  Hardcoded URLs/IPs found. Use environment variables instead."
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
  echo "FAIL"
  echo "  Files over $MAX_LINES lines found. Split into smaller modules."
  echo -e "$LONG_FILES"
  ERRORS=$((ERRORS + 1))
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

echo ""
echo "=== Results ==="
if [ $ERRORS -gt 0 ]; then
  echo "FAILED: $ERRORS blocking violation(s) found."
  exit 1
else
  echo "PASSED: All structural tests passed."
  exit 0
fi
