import { NextRequest, NextResponse } from "next/server";
import { findNearbyRestaurants } from "@/lib/restaurantService";
import type { RestaurantsApiResponse } from "@fitsy/shared";

export async function GET(
  request: NextRequest,
): Promise<NextResponse<RestaurantsApiResponse>> {
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

  // ─── Optional params ────────────────────────────────────────────────────────

  const radiusRaw = searchParams.get("radius");
  const radiusMiles = radiusRaw !== null ? Number(radiusRaw) : 3;

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

  // ─── Query ──────────────────────────────────────────────────────────────────

  try {
    const { data, total } = await findNearbyRestaurants({
      lat,
      lng,
      radiusMiles,
      targets,
      ...(cuisineTypeRaw !== null ? { cuisineType: cuisineTypeRaw } : {}),
      ...(chainOnlyRaw !== null
        ? { chainOnly: chainOnlyRaw === "true" }
        : {}),
      limit,
    });

    return NextResponse.json(
      { data, meta: { total, limit } },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" } as never,
      { status: 500 },
    );
  }
}
