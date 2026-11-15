#!/usr/bin/env bash
# Check: externally-configured settings that tests depend on (Supabase auth
# providers, for now) match the checked-in expected state, so a dashboard
# change doesn't break flows silently (#866: anonymous sign-in flipped on
# with no record, breaking onboarding flows that assumed it was off).
#
# Contract (scripts/verify/README.md): exit 0 pass, 1 fail, 2 skipped;
# one JSON line on stdout with name/status/summary/fix.
#
# Env: SUPABASE_URL, SUPABASE_ANON_KEY (dev). Read-only - this only ever
# calls Supabase's public, unauthenticated-by-design /auth/v1/settings
# endpoint (the anon key is a public client key, not a secret) and never
# prints any credential value.
set -euo pipefail
export LC_ALL=C
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="config-drift"
EXPECTED_FILE="$REPO_ROOT/scripts/verify/expected-external-config.json"
DEV_PROJECT_REF="kegycybiruksmrzvniha"

emit() { # status summary fix
  printf '{"name":"%s","status":"%s","summary":"%s","fix":"%s"}\n' "$NAME" "$1" "$2" "$3"
}
unavailable() { # summary fix
  if [ "${CI:-}" = true ] || [ "${FITSY_RUNS:-}" = ci ] || [ "${FITSY_RUNS:-}" = scheduled ]; then
    emit fail "$1" "$2"
    exit 1
  fi
  emit skipped "$1" "$2"
  exit 2
}

URL="${SUPABASE_URL:-}"
KEY="${SUPABASE_ANON_KEY:-}"
if [ -z "$URL" ] || [ -z "$KEY" ]; then
  unavailable "SUPABASE_URL/SUPABASE_ANON_KEY not set" "npm run dev:env"
fi
if [ "$URL" != "https://${DEV_PROJECT_REF}.supabase.co" ]; then
  emit fail "SUPABASE_URL is not the DEV project; config-drift only checks DEV" "point SUPABASE_URL at the DEV Supabase project"
  exit 1
fi
if ! command -v curl >/dev/null; then
  unavailable "curl not installed" "install curl"
fi
if ! command -v jq >/dev/null; then
  unavailable "jq not installed" "brew install jq"
fi

if ! SETTINGS="$(curl -sS -f "${URL}/auth/v1/settings" -H "apikey: ${KEY}")"; then
  emit fail "could not read Supabase auth settings" "verify SUPABASE_URL/SUPABASE_ANON_KEY point at a reachable dev project"
  exit 1
fi

EXPECTED_ANON="$(jq -r '.supabase.authProviders.anonymous_users' "$EXPECTED_FILE")"
ACTUAL_ANON="$(printf '%s' "$SETTINGS" | jq -r '.external.anonymous_users')"
case "$ACTUAL_ANON" in
  true|false) ;;
  *) emit fail "Supabase auth settings response did not include external.anonymous_users" "check SUPABASE_URL points at a real Supabase auth endpoint"; exit 1 ;;
esac

word() { [ "$1" = true ] && echo ON || echo OFF; }
if [ "$EXPECTED_ANON" != "$ACTUAL_ANON" ]; then
  emit fail "anonymous sign-in: expected $(word "$EXPECTED_ANON"), actual $(word "$ACTUAL_ANON")" \
    "update scripts/verify/expected-external-config.json if this was intended, or fix the Supabase dashboard auth provider setting to match"
  exit 1
fi

emit pass "external config matches expected state (anonymous sign-in: $(word "$ACTUAL_ANON"))" ""
exit 0
