import { NextRequest, NextResponse } from "next/server";
import { findNearbyRestaurants } from "@/lib/restaurantService";
import type { RestaurantResult } from "@fitsy/shared";

interface PreviewRestaurant {
  id: string;
  name: string;
  cuisineTags: string[];
  distanceMiles: number;
  photoUrl?: string;
}

interface PreviewResponse {
  data: PreviewRestaurant[];
}

/**
 * GET /api/restaurants/preview
 *
 * Public (no auth required) — returns a short list of restaurant names that
 * match the caller's macro targets. Used in the onboarding teaser screen to
 * show prospective users real restaurants before they subscribe.
 *
 * Returns only name + cuisine info. bestMatch / meal details are intentionally
 * omitted so the screen acts as a teaser.
 */
export async function GET(
  request: NextRequest,
): Promise<NextResponse<PreviewResponse | { error: string }>> {
  const { searchParams } = request.nextUrl;

  const latRaw = searchParams.get("lat");
  const lngRaw = searchParams.get("lng");

  if (latRaw === null || lngRaw === null) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Invalid lat/lng values" }, { status: 400 });
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

  try {
    // Prefer indie restaurants for the teaser — chains are less compelling as
    // a hook. Fall back to all restaurants only if the DB is too sparse locally.
    let { data } = await findNearbyRestaurants({
      lat,
      lng,
      radiusMiles: 3,
      targets,
      chainOnly: false,
      limit: 5,
    });

    if (data.length < 2) {
      ({ data } = await findNearbyRestaurants({
        lat,
        lng,
        radiusMiles: 3,
        targets,
        limit: 5,
      }));
    }

    const preview: PreviewRestaurant[] = data
      .map((r: RestaurantResult) => ({
        id: r.id,
        name: r.name,
        cuisineTags: r.cuisineTags,
        distanceMiles: r.distanceMiles,
        ...(r.photoUrl ? { photoUrl: r.photoUrl } : {}),
      }))
      .sort((a: PreviewRestaurant, b: PreviewRestaurant) => a.distanceMiles - b.distanceMiles);

    return NextResponse.json({ data: preview }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/restaurants/preview] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
