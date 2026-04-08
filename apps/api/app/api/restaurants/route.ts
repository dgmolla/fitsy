import { NextRequest, NextResponse } from "next/server";
import { findNearbyRestaurants } from "@/lib/restaurantService";
import { requireAuth } from "@/lib/auth";
import type { RestaurantsApiResponse } from "@fitsy/shared";

export async function GET(
  request: NextRequest,
): Promise<NextResponse<RestaurantsApiResponse>> {
  const auth = await requireAuth(request);
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

  // ─── Query ──────────────────────────────────────────────────────────────────

  try {
    const { data, total } = await findNearbyRestaurants({
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
    });

    return NextResponse.json(
      { data, meta: { total, limit } },
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
