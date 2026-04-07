/**
 * Google Places Service
 *
 * Discovers nearby restaurants using the Google Places Nearby Search API (v1).
 * Extracted from scripts/preload.ts as a reusable service module.
 *
 * Usage:
 *   const places = await discoverRestaurants({
 *     lat: 34.0928, lng: -118.3086, radiusMeters: 1500, maxRestaurants: 50,
 *   });
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  websiteUri: string | null;
  types: string[];
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: string | null;
}

export interface DiscoveryConfig {
  lat: number;
  lng: number;
  radiusMeters: number;
  maxRestaurants: number;
  rateLimitDelayMs?: number;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface GooglePlacesEntry {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
}

interface GooglePlacesNearbyResponse {
  places?: GooglePlacesEntry[];
  nextPageToken?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = "https://places.googleapis.com/v1";
const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.websiteUri,places.types,places.rating,places.userRatingCount,places.priceLevel";

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Discovers restaurants near the given coordinates using Google Places
 * Nearby Search. Paginates up to 3 pages (≤ 60 results).
 *
 * Throws if the Google Places API returns a non-OK status.
 */
export async function discoverRestaurants(
  config: DiscoveryConfig,
): Promise<PlaceResult[]> {
  const apiKey = process.env["GOOGLE_PLACES_API_KEY"] ?? "";
  const { lat, lng, radiusMeters, maxRestaurants, rateLimitDelayMs = 500 } =
    config;

  const results: PlaceResult[] = [];
  let pageToken: string | undefined;
  let page = 0;
  const maxPages = 3;

  while (page < maxPages && results.length < maxRestaurants) {
    page++;

    const body: Record<string, unknown> = {
      includedTypes: ["restaurant"],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
    };

    if (pageToken) {
      body["pageToken"] = pageToken;
    }

    const response = await fetch(`${BASE_URL}/places:searchNearby`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Places API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as GooglePlacesNearbyResponse;

    if (!data.places || data.places.length === 0) break;

    for (const place of data.places) {
      if (!place.id || !place.displayName?.text) continue;

      results.push({
        placeId: place.id,
        name: place.displayName.text,
        address: place.formattedAddress ?? "",
        lat: place.location?.latitude ?? lat,
        lng: place.location?.longitude ?? lng,
        websiteUri: place.websiteUri ?? null,
        types: place.types ?? [],
        rating: place.rating ?? null,
        userRatingCount: place.userRatingCount ?? null,
        priceLevel: normalizePriceLevel(place.priceLevel),
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;

    await delay(rateLimitDelayMs);
  }

  return results.slice(0, maxRestaurants);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PRICE_LEVEL_MAP: Record<string, string> = {
  PRICE_LEVEL_FREE: "$",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

function normalizePriceLevel(raw: string | undefined): string | null {
  if (!raw) return null;
  return PRICE_LEVEL_MAP[raw] ?? null;
}
