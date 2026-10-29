import { withApiTelemetry } from '@/lib/apiTelemetry';
import { NextRequest, NextResponse } from "next/server";
import { findNearbyRestaurants } from "@/lib/restaurantService";
import { findGuidedPreview } from '@/lib/guidedPreviewService';
import { createRateLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { trustedClientIp } from '@/lib/clientIp';
import { requireAuth } from "@/lib/auth";
import { parseMacroTargetParams } from "@/lib/macroTargetParams";
import type { GuidedPreviewResponse, RestaurantResult } from "@fitsy/shared";

const guidedLimiter = createRateLimiter({ namespace: 'preview-ip', windowMs: 60_000, max: 30 });

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
 * Requires a session - returns a short list of restaurant names that
 * match the caller's macro targets. Used in the onboarding teaser screen to
 * show prospective users real restaurants before they subscribe.
 *
 * Returns only name + cuisine info. bestMatch / meal details are intentionally
 * omitted for legacy clients. guided=1 explicitly exposes three meal summaries
 * for the onboarding tour, with separate coverage and goal-qualified counts.
 * Full menus and continued discovery remain subscription features.
 */
async function handleGET(
  request: NextRequest,
): Promise<NextResponse<PreviewResponse | GuidedPreviewResponse | { error: string }> | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = request.nextUrl;

  const latRaw = searchParams.get("lat");
  const lngRaw = searchParams.get("lng");

  if (latRaw === null || lngRaw === null || !latRaw.trim() || !lngRaw.trim()) {
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
  const selectedItemId = searchParams.get('selectedItemId') ?? undefined;
  if (guided && ((query?.length ?? 0) > 100 || ["cursor", "limit", "pageSize", "radiusMiles"].some(key => searchParams.has(key))
    || (selectedItemId !== undefined && (!selectedItemId.trim() || selectedItemId.length > 128 || searchParams.getAll('selectedItemId').length > 1)))) {
    return NextResponse.json({ error: "Guided preview supports a craving and a fixed three-pick sample" }, { status: 400 });
  }

  try {
    if (guided) {
      // A signed-in account can see the bounded tour sample before subscribing.
      // The shared auth guard also limits IPs across every data route.
      const quota = await guidedLimiter.check(trustedClientIp(request));
      if (!quota.ok) return rateLimitResponse(quota, 'Too many preview searches. Please try again shortly.');
      return NextResponse.json(await findGuidedPreview({ lat, lng, targets, query, selectedItemId }));
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
  } catch {
    console.error("[GET /api/restaurants/preview] Error:");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const GET = withApiTelemetry('GET', '/api/restaurants/preview', handleGET);
