#!/usr/bin/env bash
# T1: the shortest path is the best path. Scaffold an API route in the
# guarded, tested, typed shape so the easy way IS the correct way.
#
#   scripts/gen/route.sh <segment/path> --auth=public|user|subscriber
#   e.g. scripts/gen/route.sh coach/tips --auth=subscriber
#
# Emits: apps/api/app/api/<path>/route.ts + colocated route.test.ts, and
# prints the follow-ups (zod contract in packages/shared, structural check 12
# allowlist if public under /restaurants).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEG="${1:?route path, e.g. coach/tips}"; AUTH="public"
for a in "$@"; do case "$a" in --auth=*) AUTH="${a#--auth=}";; esac; done
case "$AUTH" in public|user|subscriber) ;; *) echo "--auth must be public|user|subscriber" >&2; exit 1;; esac
DIR="$REPO_ROOT/apps/api/app/api/$SEG"
[ -e "$DIR/route.ts" ] && { echo "$DIR/route.ts already exists" >&2; exit 1; }
mkdir -p "$DIR"
NAME="$(basename "$SEG")"
PASCAL="$(python3 -c "import sys;print(''.join(w.capitalize() for w in sys.argv[1].replace('_','-').split('-')))" "$NAME")"

case "$AUTH" in
  public)
    GUARD_IMPORT=""
    GUARD_BODY="  // Public route: no auth. If this serves subscriber data, use --auth=subscriber instead."
    ;;
  user)
    GUARD_IMPORT='import { requireAuth } from "@/lib/auth";
import { NextRequest } from "next/server";'
    GUARD_BODY='  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;'
    ;;
  subscriber)
    GUARD_IMPORT='import { optionalSubscription } from "@/lib/subscription";
import { NextRequest } from "next/server";'
    GUARD_BODY='  const { payload, entitled } = await optionalSubscription(request);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" } as never, { status: 401 });
  }
  if (!entitled) {
    // Either 402-gate hard, or serve a locked teaser like /api/restaurants
    // (meta.locked) - pick one and test it in apps/api/tests/db/.
    return NextResponse.json({ error: "subscription_required" } as never, { status: 402 });
  }'
    ;;
esac

SIG="()"
[ "$AUTH" != "public" ] && SIG="(request: NextRequest)"

cat > "$DIR/route.ts" <<ROUTE
import { NextResponse } from "next/server";
${GUARD_IMPORT}

interface ${PASCAL}Response {
  // TODO: define the response shape, then mirror it as a zod schema in
  // packages/shared/src/contracts/ (tenet T4) so the DB tests can parse it.
  ok: boolean;
}

/**
 * GET /api/${SEG}
 *
 * Auth: ${AUTH}. Error responses use { "error": "message" } with the
 * appropriate status (project convention).
 */
export async function GET${SIG}: Promise<NextResponse<${PASCAL}Response> | NextResponse> {
${GUARD_BODY}
  return NextResponse.json({ ok: true }, { status: 200 });
}
ROUTE

case "$AUTH" in
  public) TESTCASE='  it("responds 200 without auth (public route)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });' ;;
  user) TESTCASE='  it("rejects unauthenticated requests with 401", async () => {
    const res = await GET(new NextRequest("http://test/api/'"$SEG"'"));
    expect(res.status).toBe(401);
  });' ;;
  subscriber) TESTCASE='  it("rejects unauthenticated requests with 401", async () => {
    const res = await GET(new NextRequest("http://test/api/'"$SEG"'"));
    expect(res.status).toBe(401);
  });
  // TODO: entitlement paths (402 for free users) belong in apps/api/tests/db/' ;;
esac

IMPORT_REQ=""
[ "$AUTH" != "public" ] && IMPORT_REQ='
import { NextRequest } from "next/server";
// jose is ESM-only; external boundary, mockable (see tests/db/ for the pattern)
jest.mock("jose", () => ({}));'

cat > "$DIR/route.test.ts" <<TEST
import { GET } from "./route";${IMPORT_REQ}

describe("GET /api/${SEG}", () => {
${TESTCASE}
});
TEST

echo "generated:"
echo "  ${DIR#$REPO_ROOT/}/route.ts        (auth: $AUTH)"
echo "  ${DIR#$REPO_ROOT/}/route.test.ts"
echo "next:"
echo "  - define the response shape + zod contract (packages/shared/src/contracts/)"
if [[ "$SEG" == restaurants/* ]]; then
  if [ "$AUTH" = "subscriber" ]; then
    echo "  - /restaurants family standard is the TEASER LOCK (serve results with meta.locked=true when unentitled), not the scaffold's 402 gate - follow apps/api/app/api/restaurants/route.ts"
  else
    echo "  - route under /restaurants without the subscription guard: structural check 12 will fail until you allowlist it in scripts/structural-tests.sh with a why"
  fi
fi
echo "  - npm run verify before pushing"
