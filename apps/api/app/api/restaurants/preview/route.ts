import { NextRequest, NextResponse } from "next/server";
import { countNearbyDishes, findNearbyRestaurants } from "@/lib/restaurantService";
import { parseMacroTargetParams } from "@/lib/macroTargetParams";
import type { GuidedPreviewResponse, RestaurantResult } from "@fitsy/shared";

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
 * Public (no auth required) - returns a short list of restaurant names that
 * match the caller's macro targets. Used in the onboarding teaser screen to
 * show prospective users real restaurants before they subscribe.
 *
 * Returns only name + cuisine info. bestMatch / meal details are intentionally
 * omitted for legacy clients. guided=1 explicitly exposes three meal summaries
 * for the onboarding tour, with an unfiltered local dish count.
 * Full menus and continued discovery remain subscription features.
 */
export async function GET(
  request: NextRequest,
): Promise<NextResponse<PreviewResponse | GuidedPreviewResponse | { error: string }>> {
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

  let targets: ReturnType<typeof parseMacroTargetParams>;
  try {
    targets = parseMacroTargetParams(searchParams);
  } catch {
    return NextResponse.json({ error: "Invalid macro target" }, { status: 400 });
  }

  const guided = searchParams.get("guided") === "1";
  const query = searchParams.get("q")?.trim();
  if (guided && ((query?.length ?? 0) > 100 || ["cursor", "limit", "pageSize", "selectedItemId", "radiusMiles"].some(key => searchParams.has(key)))) {
    return NextResponse.json({ error: "Guided preview supports a craving and a fixed three-pick sample" }, { status: 400 });
  }

  try {
    if (guided) {
      const [{ data }, nearbyDishCount] = await Promise.all([
        findNearbyRestaurants({ lat, lng, radiusMiles: 3, targets, query, limit: 3 }),
        countNearbyDishes(lat, lng, 3),
      ]);
      return NextResponse.json({ data, meta: { nearbyDishCount, radiusMiles: 3 } });
    }
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
