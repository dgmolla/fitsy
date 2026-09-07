#!/usr/bin/env bash
# API end-to-end smoke against a deployed base URL.
#   scripts/verify/api-e2e.sh --base=https://dev.fitsy.org --write   # full (register writes)
#   scripts/verify/api-e2e.sh --base=https://fitsy.org               # read-only (default)
# Prod runs MUST use --prod-safe: registration on prod creates test users
# (the 2026-08 pollution incident class).
set -uo pipefail
# read-only by default; writes (register probe) are opt-in so routine runs
# never create users anywhere
BASE=""; SAFE=1
for a in "$@"; do case "$a" in --base=*) BASE="${a#--base=}";; --write) SAFE=0;; --prod-safe) SAFE=1;; esac; done
# default to the dev environment so the registry runner can invoke it bare
BASE="${BASE:-https://dev.fitsy.org}"
# ALLOW-list: write mode (register probe) only ever runs against the dev
# environment or localhost; every other host - prod, previews, aliases - is
# read-only, full stop (test-user pollution incident class).
if [ "$SAFE" = "0" ]; then
  case "$BASE" in
    https://dev.fitsy.org*|http://localhost*|http://127.0.0.1*) : ;;
    *)
      printf '{"name":"api-e2e","status":"fail","summary":"write-mode allowed only against dev.fitsy.org or localhost, not %s","fix":"drop --write (read-only works everywhere), or point --base at the dev environment"}\n' "$BASE"
      exit 1 ;;
  esac
fi
FAILS=""
say() { echo "  $1 -> $2" >&2; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

H="$(code "$BASE/api/health")"; say health "$H"; [ "$H" = "200" ] || FAILS="$FAILS health=$H"
# Since the onboarding teaser (2026-09), unauth search returns 200 with
# meta.locked=true. The invariant: unentitled responses are ALWAYS locked.
UO="$(curl -s --max-time 20 "$BASE/api/restaurants?lat=34.0522&lng=-118.2437&radius=3" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("meta",{}).get("locked"), len(d.get("data",[])))' 2>/dev/null)"
UL="${UO%% *}"; UN="${UO##* }"
say "unauth search locked/results (expect True / >0)" "$UO"
[ "$UL" = "True" ] || FAILS="$FAILS unauth-locked=$UL"
[ "${UN:-0}" -gt 0 ] || FAILS="$FAILS unauth-results=0"
# optional authenticated probe on prod: set PROD_SMOKE_EMAIL/PASSWORD (demo acct)
if [ "$SAFE" = "1" ] && { [ -z "${PROD_SMOKE_EMAIL:-}" ] || [ -z "${PROD_SMOKE_PASSWORD:-}" ]; }; then
  say "entitled-account probe" "SKIPPED (set PROD_SMOKE_EMAIL/PASSWORD to activate)"
fi
if [ "$SAFE" = "1" ] && [ -n "${PROD_SMOKE_EMAIL:-}" ] && [ -n "${PROD_SMOKE_PASSWORD:-}" ]; then
  TOK="$(curl -s --max-time 20 -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$PROD_SMOKE_EMAIL\",\"password\":\"$PROD_SMOKE_PASSWORD\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)"
  [ -n "$TOK" ] || FAILS="$FAILS prod-login"
  DOUT="$(curl -s --max-time 30 -H "Authorization: Bearer $TOK" "$BASE/api/restaurants?lat=34.0522&lng=-118.2437&radius=3" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("meta",{}).get("locked"), len(d.get("data",[])))' 2>/dev/null)"
  DL="${DOUT%% *}"; DN="${DOUT##* }"
  say "demo-account locked/results (expect False|None / >0)" "$DOUT"
  if { [ "$DL" != "False" ] && [ "$DL" != "None" ]; } || [ "${DN:-0}" -le 0 ]; then FAILS="$FAILS demo-probe=$DOUT"; fi
fi

if [ "$SAFE" = "0" ]; then
  PASS="fitsy-seed-pass-2026"
  TOK_FREE="$(curl -s --max-time 20 -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"email\":\"seed-free@fitsy.dev\",\"password\":\"$PASS\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)"
  TOK_PRO="$(curl -s --max-time 20 -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"email\":\"seed-pro@fitsy.dev\",\"password\":\"$PASS\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)"
  [ -n "$TOK_FREE" ] || FAILS="$FAILS login-free"
  [ -n "$TOK_PRO" ] || FAILS="$FAILS login-pro"
  FL="$(curl -s --max-time 30 -H "Authorization: Bearer $TOK_FREE" "$BASE/api/restaurants?lat=34.0522&lng=-118.2437&radius=3&calories=600" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("meta",{}).get("locked"))' 2>/dev/null)"
  say "free search locked (expect True)" "$FL"; [ "$FL" = "True" ] || FAILS="$FAILS free-locked=$FL"
  PRO_OUT="$(curl -s --max-time 30 -H "Authorization: Bearer $TOK_PRO" "$BASE/api/restaurants?lat=34.0522&lng=-118.2437&radius=3&calories=600" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len(d.get("data",[])), d.get("meta",{}).get("locked"))' 2>/dev/null)"
  P="${PRO_OUT%% *}"; PLOCK="${PRO_OUT##* }"
  say "pro search results/locked (expect >0 / not True)" "$PRO_OUT"
  [ "${P:-0}" -gt 0 ] || FAILS="$FAILS pro-results=0"
  [ "$PLOCK" != "True" ] || FAILS="$FAILS pro-LOCKED-despite-entitlement"
  R="$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" -H 'content-type: application/json' -d "{\"email\":\"e2e-$(date +%s)-$RANDOM@fitsy.dev\",\"password\":\"e2e-pass-12345\",\"name\":\"E2E\"}")"; say "register (expect 201)" "$R"; [ "$R" = "201" ] || FAILS="$FAILS register=$R"
fi

if [ -n "$FAILS" ]; then
  printf '{"name":"api-e2e","status":"fail","summary":"%s","fix":"check the failing route on %s; if this is a fresh deploy, roll back first (scripts/deploy/rollback.sh api), diagnose second"}\n' "$(echo $FAILS | xargs)" "$BASE"
  exit 1
fi
printf '{"name":"api-e2e","status":"pass","summary":"smoke green against %s (prod-safe=%s)","fix":""}\n' "$BASE" "$SAFE"
