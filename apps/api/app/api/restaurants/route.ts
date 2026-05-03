import { NextRequest, NextResponse, after } from "next/server";
import { findNearbyRestaurants, decodeCursor } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";
import { getApiEmitter } from "@/lib/apiEmitter";
import type { RestaurantsApiResponse } from "@fitsy/shared";

export async function GET(
  request: NextRequest,
): Promise<NextResponse<RestaurantsApiResponse>> {
  const tEntry = Date.now();
  const auth = await requireAuth(request);
  const tAfterAuth = Date.now();
  if (auth instanceof NextResponse) return auth as never;

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

  const caloriesRaw = searchParams.get("calories");
  const proteinRaw = searchParams.get("protein");
  const carbsRaw = searchParams.get("carbs");
  const fatRaw = searchParams.get("fat");

  const targets = {
    ...(caloriesRaw !== null ? { calories: Number(caloriesRaw) } : {}),
    ...(proteinRaw !== null ? { proteinG: Number(proteinRaw) } : {}),
    ...(carbsRaw !== null ? { carbsG: Number(carbsRaw) } : {}),
    ...(fatRaw !== null ? { fatG: Number(fatRaw) } : {}),
  };

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

  // Optional opaque pagination cursor from the previous page's `nextCursor`.
  // Decode + validate before hitting the DB so a malformed cursor returns 400
  // instead of producing silently-wrong pagination.
  const cursorRaw = searchParams.get("cursor");
  let decodedCursor: { id: string; distanceMiles: number } | undefined;
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

  // ─── Query ──────────────────────────────────────────────────────────────────

  try {
    const tBeforeQuery = Date.now();
    const { data, total, nextCursor } = await findNearbyRestaurants({
      lat,
      lng,
      radiusMiles,
      targets,
      ...(cuisineTypeRaw !== null ? { cuisineType: cuisineTypeRaw } : {}),
      ...(chainOnlyRaw !== null ? { chainOnly: chainOnlyRaw === "true" } : {}),
      ...(dietaryRaw !== null ? { dietary: dietaryRaw } : {}),
      ...(maxPriceLevelRaw !== null ? { maxPriceLevel: maxPriceLevelRaw } : {}),
      ...(minRating !== undefined ? { minRating } : {}),
      limit,
      ...(decodedCursor !== undefined ? { cursor: decodedCursor } : {}),
    });
    const tDone = Date.now();
    const emitter = getApiEmitter();
    emitter.emitSearchRoute({
      route: "/api/restaurants",
      authMs: tAfterAuth - tEntry,
      queryMs: tDone - tBeforeQuery,
      durationMs: tDone - tEntry,
      resultCount: total,
      hasTargets: Object.keys(targets).length > 0,
      ...(cuisineTypeRaw !== null ? { cuisineFilter: cuisineTypeRaw } : {}),
      status: 200,
    });
    // after() defers flush past response; only valid inside Next.js request runtime.
    try { after(() => emitter.flush()); } catch { /* test env or non-runtime */ }

    return NextResponse.json(
      { data, meta: { total, limit, nextCursor } },
      { status: 200 },
    );
  } catch (err) {
    console.error("[GET /api/restaurants] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" } as never,
      { status: 500 },
    );
  }
}
