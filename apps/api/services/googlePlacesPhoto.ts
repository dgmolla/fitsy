/**
 * Google Places photo fallback.
 *
 * Uses the Places API (new) — Text Search → photo fetch — to retrieve a
 * Google CDN photo URL for a restaurant, validated by lat/lng proximity.
 *
 * Requires GOOGLE_PLACES_API_KEY env var. Returns null when the key is
 * absent, the search fails, or no photo is found within 1000m.
 *
 * Cost: 1 Text Search call ($0.017) + 1 Photo Fetch call (~$0.007) per
 * restaurant. Only called when both UberEats and the primary source
 * returned no image.
 */

const PLACES_BASE = "https://places.googleapis.com/v1";

interface PlacesSearchResult {
  places?: Array<{
    id?: string;
    location?: { latitude?: number; longitude?: number };
    photos?: Array<{ name?: string }>;
  }>;
}

interface PhotoMediaResult {
  photoUri?: string;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fetch a Google CDN photo URL for a restaurant using Places API (new).
 *
 * Flow:
 *   1. POST /places:searchText with name + 500m location bias
 *   2. Validate closest result is within 1000m of the supplied lat/lng
 *   3. GET /{photo.name}/media?skipHttpRedirect=true → returns { photoUri }
 */
export async function fetchGooglePlacesPhoto(
  name: string,
  lat: number,
  lng: number,
): Promise<string | null> {
  const apiKey = process.env["GOOGLE_PLACES_API_KEY"];
  if (!apiKey) return null;

  // Step 1: Text search with tight location bias
  let searchRes: Response;
  try {
    searchRes = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.location,places.photos",
      },
      body: JSON.stringify({
        textQuery: name,
        locationBias: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 500.0 },
        },
        maxResultCount: 3,
      }),
    });
  } catch {
    return null;
  }

  if (!searchRes.ok) return null;

  const searchData = (await searchRes.json()) as PlacesSearchResult;
  const places = searchData.places ?? [];

  // Step 2: Find the closest result within 1000m (1km guard — prevents photos from wrong city)
  let bestPlace: (typeof places)[number] | null = null;
  let bestDist = Infinity;
  for (const place of places) {
    if (place.location?.latitude == null || place.location?.longitude == null) continue;
    const dist = haversineMeters(lat, lng, place.location.latitude, place.location.longitude);
    if (dist < 1000 && dist < bestDist) {
      bestDist = dist;
      bestPlace = place;
    }
  }

  if (!bestPlace?.photos?.[0]?.name) return null;

  // Step 3: Fetch photo — skipHttpRedirect=true returns JSON with photoUri (Google CDN URL)
  const photoName = bestPlace.photos[0].name;
  let photoRes: Response;
  try {
    photoRes = await fetch(
      `${PLACES_BASE}/${photoName}/media?maxWidthPx=800&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": apiKey } },
    );
  } catch {
    return null;
  }

  if (!photoRes.ok) return null;

  const photoData = (await photoRes.json()) as PhotoMediaResult;
  return photoData.photoUri ?? null;
}
