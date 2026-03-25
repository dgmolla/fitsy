#!/usr/bin/env bash
# verify-prod.sh — smoke-test Fitsy production endpoints
# Usage: bash scripts/verify-prod.sh [BASE_URL]
# Default BASE_URL: https://fitsy-api.vercel.app

set -euo pipefail

BASE_URL="${1:-https://fitsy-api.vercel.app}"
PASS=0
FAIL=0
ERRORS=()

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
blue()  { printf '\033[0;34m%s\033[0m\n' "$1"; }

check() {
  local name="$1"; local cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    green "  PASS  $name"
    PASS=$((PASS + 1))
  else
    red   "  FAIL  $name"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name")
  fi
}

blue "=== Fitsy Production Verification: $BASE_URL ==="
echo ""

# 1. Health check
check "GET /api/health returns 200" \
  "curl -sf --max-time 10 '$BASE_URL/api/health'"

# 2. Auth: register
TEST_EMAIL="verify-$(date +%s)@fitsy-verify.internal"
REGISTER_BODY=$(curl -sf --max-time 15 -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Verify Script\",\"email\":\"$TEST_EMAIL\",\"password\":\"Verify1234!\"}" 2>/dev/null || echo "{}")

check "POST /api/auth/register returns token" \
  "echo '$REGISTER_BODY' | grep -q '\"token\"'"

# 3. Auth: login
LOGIN_BODY=$(curl -sf --max-time 15 -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Verify1234!\"}" 2>/dev/null || echo "{}")

TOKEN=$(echo "$LOGIN_BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")

check "POST /api/auth/login returns token" \
  "[ -n '$TOKEN' ]"

# 4. Restaurant search (90029 area)
if [ -n "$TOKEN" ]; then
  SEARCH_BODY=$(curl -sf --max-time 20 \
    "$BASE_URL/api/restaurants?lat=34.0928&lng=-118.3086&protein=40&calories=600" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "{}")

  check "GET /api/restaurants returns results array" \
    "echo '$SEARCH_BODY' | grep -q '\"results\"'"

  RESULT_COUNT=$(echo "$SEARCH_BODY" | grep -o '"results":\[' | wc -l || echo "0")
  check "Restaurant results array is present" \
    "[ '$RESULT_COUNT' -ge 1 ]"
fi

# 5. Auth guard (unauthenticated request rejected)
UNAUTH_STATUS=$(curl -so /dev/null -w "%{http_code}" --max-time 10 \
  "$BASE_URL/api/restaurants?lat=34.0928&lng=-118.3086" 2>/dev/null || echo "000")

check "GET /api/restaurants without token returns 401" \
  "[ '$UNAUTH_STATUS' = '401' ]"

echo ""
blue "=== Results ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"

if [ $FAIL -gt 0 ]; then
  echo ""
  red "Failed checks:"
  for err in "${ERRORS[@]}"; do
    red "  - $err"
  done
  exit 1
else
  green "All checks passed — production is healthy."
fi
