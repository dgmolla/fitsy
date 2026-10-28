import { NextRequest, NextResponse, after } from "next/server";
import { findNearbyRestaurants, decodeCursor, type PaginationCursor, type NearbyRestaurantsParams } from "@/lib/restaurantService";
import { restaurantCursorContext } from '@/lib/restaurantCursorContext';
import { getEntitlementStatus, optionalSubscription, syncSubscriptionFromRevenueCat } from "@/lib/subscription";
import { parseSearchShuffle } from '@/lib/shuffleSearch';
import { createRateLimiter, rateLimitResponse } from '@/lib/rateLimit';
import { getApiEmitter } from "@/lib/apiEmitter";
import type { RestaurantsApiResponse } from "@fitsy/shared";
import { parseMacroTargetParams } from "@/lib/macroTargetParams";

const shuffleLimiter = createRateLimiter({ namespace: 'shuffle-user', windowMs: 60_000, max: 30 });
const headers = { 'Cache-Control': 'private, no-store' };
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
): Promise<NextResponse<RestaurantsApiResponse> | NextResponse> {
  const tEntry = Date.now();
  // A session is mandatory, including for the signed-in free/lapsed teaser.
  const subscription = await optionalSubscription(request);
  if (subscription instanceof NextResponse) return subscription;
  let { entitled } = subscription;
  const tAfterAuth = Date.now();

  const { searchParams } = request.nextUrl;

  // ─── Required params ────────────────────────────────────────────────────────

  const latRaw = searchParams.get("lat");
  const lngRaw = searchParams.get("lng");

  if (latRaw === null || lngRaw === null) {
    return NextResponse.json(
      { error: "lat and lng are required" } as never,
      { status: 400 },
    );
  }

  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (!isFinite(lat) || !isFinite(lng)) {
    return NextResponse.json(
      { error: "Invalid lat/lng values" } as never,
      { status: 400 },
    );
  }

  if (lat < -90 || lat > 90) {
    return NextResponse.json(
      { error: "lat must be between -90 and 90" } as never,
      { status: 400 },
    );
  }

  if (lng < -180 || lng > 180) {
    return NextResponse.json(
      { error: "lng must be between -180 and 180" } as never,
      { status: 400 },
    );
  }

  // ─── Optional params ────────────────────────────────────────────────────────

  const radiusRaw = searchParams.get("radius");
  const radiusMiles = radiusRaw !== null ? Number(radiusRaw) : 3;

  if (!isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 50) {
    return NextResponse.json(
      { error: "radius must be between 0 and 50 miles" } as never,
      { status: 400 },
    );
  }

  const limitRaw = searchParams.get("limit");
  const limit = limitRaw !== null ? Number(limitRaw) : 20;

  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json(
      { error: "limit must be between 1 and 50" } as never,
      { status: 400 },
    );
  }

  let targets: ReturnType<typeof parseMacroTargetParams>;
  try {
    targets = parseMacroTargetParams(searchParams);
  } catch {
    return NextResponse.json({ error: "Invalid macro target" } as never, { status: 400 });
  }

  const cuisineTypeRaw = searchParams.get("cuisineType");
  const chainOnlyRaw = searchParams.get("chainOnly");
  const dietaryRaw = searchParams.get("dietary");
  const maxPriceLevelRaw = searchParams.get("maxPriceLevel");
  const minRatingRaw = searchParams.get("minRating");

  const minRating = minRatingRaw !== null ? Number(minRatingRaw) : undefined;
  if (minRating !== undefined && (!isFinite(minRating) || minRating < 0 || minRating > 5)) {
    return NextResponse.json(
      { error: "minRating must be between 0 and 5" } as never,
      { status: 400 },
    );
  }

  const VALID_PRICE_LEVELS = ["$", "$$", "$$$", "$$$$"];
  if (maxPriceLevelRaw !== null && !VALID_PRICE_LEVELS.includes(maxPriceLevelRaw)) {
    return NextResponse.json(
      { error: `maxPriceLevel must be one of: ${VALID_PRICE_LEVELS.join(", ")}` } as never,
      { status: 400 },
    );
  }

  // Free-text query. Trim and treat empty/whitespace as absent; cap length to
  // bound the ILIKE pattern. Reject overlong input rather than silently
  // truncating so the client surfaces a clear error.
  const MAX_QUERY_LENGTH = 100;
  const queryRaw = searchParams.get("q");
  const query = queryRaw !== null ? queryRaw.trim() : "";
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `q must be ${MAX_QUERY_LENGTH} characters or fewer` } as never,
      { status: 400 },
    );
  }

  // Optional opaque pagination cursor from the previous page's `nextCursor`.
  // Decode + validate before hitting the DB so a malformed cursor returns 400
  // instead of producing silently-wrong pagination.
  const cursorRaw = searchParams.get("cursor");
  let decodedCursor: PaginationCursor | undefined;
  if (cursorRaw !== null) {
    const decoded = decodeCursor(cursorRaw);
    if (decoded === null) {
      return NextResponse.json(
        { error: "Invalid cursor" } as never,
        { status: 400 },
      );
    }
    decodedCursor = decoded;
  }

  const goalMatchedRaw = searchParams.get("goalMatched");
  if ((goalMatchedRaw !== null && !["0", "1"].includes(goalMatchedRaw)) || searchParams.getAll("goalMatched").length > 1) {
    return NextResponse.json({ error: "Invalid goalMatched flag" } as never, { status: 400 });
  }
  let shuffle: ReturnType<typeof parseSearchShuffle>;
  try { shuffle = parseSearchShuffle(searchParams, decodedCursor?.shuffleSeed); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400, headers }); }
  if (shuffle) {
    try {
      const limited = await shuffleLimiter.check(`user:${subscription.payload.sub}`);
      if (!limited.ok) return rateLimitResponse(limited);
      if (!entitled) {
        // Keep direct callers safe from purchase/webhook races, including the future widget.
        await syncSubscriptionFromRevenueCat(subscription.payload.sub);
        entitled = (await getEntitlementStatus(subscription.payload.sub, subscription.payload.email)).active;
      }
    } catch {
      console.error('[GET /api/restaurants] Subscription reconciliation failed:'); // eslint-disable-line no-console
      return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers });
    }
  }
  const options: NearbyRestaurantsParams = {
    lat,
    lng,
    radiusMiles,
    // Locked shuffle membership must not reveal paid nutrition matches.
    targets: shuffle && !entitled ? {} : targets,
    ...(shuffle ? { shuffle } : {}),
    // Filtering locked rows by nutrition would reveal match membership despite redacting bestMatch.
    goalMatched: entitled && goalMatchedRaw === "1",
    ...(cuisineTypeRaw !== null ? { cuisineType: cuisineTypeRaw } : {}),
    ...(chainOnlyRaw !== null ? { chainOnly: chainOnlyRaw === "true" } : {}),
    ...(dietaryRaw !== null ? { dietary: dietaryRaw } : {}),
    ...(maxPriceLevelRaw !== null ? { maxPriceLevel: maxPriceLevelRaw } : {}),
    ...(minRating !== undefined ? { minRating } : {}),
    ...(query !== "" ? { query } : {}),
    limit,
    ...(decodedCursor !== undefined ? { cursor: decodedCursor } : {}),
  };
  if (decodedCursor && decodedCursor.context !== restaurantCursorContext(options)) {
    return NextResponse.json({ error: "Cursor belongs to another search context" } as never, { status: 400 });
  }

  // ─── Query ──────────────────────────────────────────────────────────────────

  try {
    const tBeforeQuery = Date.now();
    const { data, total, nextCursor } = await findNearbyRestaurants(options);
    const tDone = Date.now();
    const emitter = getApiEmitter();
    emitter.emitSearchRoute({
      route: "/api/restaurants",
      authMs: tAfterAuth - tEntry,
      queryMs: tDone - tBeforeQuery,
      durationMs: tDone - tEntry,
      resultCount: total,
      hasTargets: Object.keys(targets).length > 0,
      hasCuisineFilter: cuisineTypeRaw !== null,
      ...(query !== "" ? { hasQuery: true, queryLength: query.length } : {}),
      status: 200,
    });
    // after() defers flush past response; only valid inside Next.js request runtime.
    try { after(() => emitter.flush()); } catch { /* test env or non-runtime */ }

    // Strip macro-match data for unentitled callers rather than omitting rows —
    // restaurant identity (name/photo/distance) isn't the paid asset, the
    // macro-matched dish is. Every row is stripped uniformly, never just some,
    // so the client can't infer real matches from which rows kept `bestMatch`.
    const responseData = entitled ? data : data.map((r) => ({ ...r, bestMatch: null }));

    return NextResponse.json(
      { data: responseData, meta: { total, limit, nextCursor, locked: !entitled } },
      { status: 200, headers },
    );
  } catch {
    console.error("[GET /api/restaurants] Error:");
    return NextResponse.json(
      { error: "Internal server error" } as never,
      { status: 500 },
    );
  }
}
