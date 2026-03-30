import { PrismaClient } from "@prisma/client";
import {
  computeMatchScore,
  hasTargets,
  type MacroTargets,
  type ScoredItem,
} from "./macroScoring";
import {
  geoCacheKey,
  geoCacheGet,
  geoCacheSet,
  type CachedRestaurant,
} from "./geoCache";
import type { RestaurantResult, MenuResponse } from "@fitsy/shared";

// ─── Prisma singleton ─────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

// ─── Query params ─────────────────────────────────────────────────────────────

export interface NearbyRestaurantsParams {
  lat: number;
  lng: number;
  radiusMiles: number;
  targets: MacroTargets;
  cuisineType?: string | undefined;
  chainOnly?: boolean | undefined;
  limit: number;
}

// ─── Distance helpers ─────────────────────────────────────────────────────────

function computeBoundingBox(
  lat: number,
  lng: number,
  radiusMiles: number,
): { latMin: number; latMax: number; lngMin: number; lngMax: number } {
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));
  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lngMin: lng - lngDelta,
    lngMax: lng + lngDelta,
  };
}

function computeDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const latDiff = lat2 - lat1;
  const lngDiff = (lng2 - lng1) * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 69;
}

// ─── Layer 1: Fetch + cache restaurant data (shared across users) ────────────

async function fetchGeoData(
  lat: number,
  lng: number,
  radiusMiles: number,
  cuisineType?: string,
  chainOnly?: boolean,
): Promise<{ restaurants: CachedRestaurant[]; cacheHit: boolean }> {
  const key = geoCacheKey(lat, lng, radiusMiles, cuisineType, chainOnly);
  const cached = geoCacheGet(key);

  if (cached) {
    return { restaurants: cached, cacheHit: true };
  }

  const { latMin, latMax, lngMin, lngMax } = computeBoundingBox(
    lat,
    lng,
    radiusMiles,
  );

  const dbRestaurants = await prisma.restaurant.findMany({
    where: {
      lat: { gte: latMin, lte: latMax },
      lng: { gte: lngMin, lte: lngMax },
      ...(cuisineType !== undefined
        ? { cuisineTags: { has: cuisineType } }
        : {}),
      ...(chainOnly !== undefined ? { chainFlag: chainOnly } : {}),
    },
    include: {
      menuItems: {
        include: {
          macroEstimates: {
            orderBy: { estimatedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  // Filter to true radius and flatten into cache-friendly shape
  const restaurants: CachedRestaurant[] = dbRestaurants
    .filter((r) => computeDistanceMiles(lat, lng, r.lat, r.lng) <= radiusMiles)
    .map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      cuisineTags: r.cuisineTags,
      chainFlag: r.chainFlag,
      photoUrl: r.photoUrl,
      menuItems: r.menuItems
        .filter((item) => item.macroEstimates.length > 0)
        .map((item) => {
          const est = item.macroEstimates[0]!;
          return {
            menuItemId: item.id,
            name: item.name,
            calories: est.calories,
            proteinG: est.proteinG,
            carbsG: est.carbsG,
            fatG: est.fatG,
            confidence: est.confidence,
          };
        }),
    }));

  geoCacheSet(key, restaurants);
  return { restaurants, cacheHit: false };
}

// ─── Layer 2: Per-user scoring (no DB, runs on cached data) ──────────────────

function scoreRestaurant(
  restaurant: CachedRestaurant,
  userLat: number,
  userLng: number,
  targets: MacroTargets,
): {
  distanceMiles: number;
  bestMatch: ScoredItem | null;
} {
  const distanceMiles = computeDistanceMiles(
    userLat,
    userLng,
    restaurant.lat,
    restaurant.lng,
  );

  let bestMatch: ScoredItem | null = null;

  if (hasTargets(targets)) {
    let bestScore = Infinity;

    for (const item of restaurant.menuItems) {
      const score = computeMatchScore(targets, {
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        confidence: item.confidence as "HIGH" | "MEDIUM" | "LOW",
      });

      if (score !== null && score < bestScore) {
        bestScore = score;
        bestMatch = {
          menuItemId: item.menuItemId,
          name: item.name,
          macros: {
            calories: item.calories,
            proteinG: item.proteinG,
            carbsG: item.carbsG,
            fatG: item.fatG,
            confidence: item.confidence as "HIGH" | "MEDIUM" | "LOW",
          },
          score,
        };
      }
    }
  }

  return { distanceMiles, bestMatch };
}

// ─── Service: GET /api/restaurants ───────────────────────────────────────────

export async function findNearbyRestaurants(
  params: NearbyRestaurantsParams,
): Promise<{ data: RestaurantResult[]; total: number }> {
  const { lat, lng, radiusMiles, targets, cuisineType, chainOnly, limit } =
    params;

  const startMs = Date.now();

  // Layer 1: geo cache (shared)
  const { restaurants, cacheHit } = await fetchGeoData(
    lat,
    lng,
    radiusMiles,
    cuisineType,
    chainOnly,
  );

  const fetchMs = Date.now() - startMs;

  // Layer 2: per-user scoring (cheap math)
  const scored = restaurants.map((r) => ({
    restaurant: r,
    ...scoreRestaurant(r, lat, lng, targets),
  }));

  // Sort: by match score if targets, else by distance
  scored.sort((a, b) => {
    if (hasTargets(targets)) {
      const scoreA = a.bestMatch?.score ?? Infinity;
      const scoreB = b.bestMatch?.score ?? Infinity;
      if (scoreA !== scoreB) return scoreA - scoreB;
    }
    return a.distanceMiles - b.distanceMiles;
  });

  const total = scored.length;
  const paginated = scored.slice(0, limit);

  const data: RestaurantResult[] = paginated.map(
    ({ restaurant: r, distanceMiles, bestMatch }) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      distanceMiles: Math.round(distanceMiles * 100) / 100,
      cuisineTags: r.cuisineTags,
      chainFlag: r.chainFlag,
      ...(r.photoUrl ? { photoUrl: r.photoUrl } : {}),
      bestMatch: bestMatch
        ? {
            menuItemId: bestMatch.menuItemId,
            name: bestMatch.name,
            calories: bestMatch.macros.calories,
            proteinG: bestMatch.macros.proteinG,
            carbsG: bestMatch.macros.carbsG,
            fatG: bestMatch.macros.fatG,
            confidence: bestMatch.macros.confidence,
            matchScore: Math.round(bestMatch.score * 10000) / 10000,
          }
        : null,
    }),
  );

  const totalMs = Date.now() - startMs;

  // Structured log for Axiom
  console.log(
    JSON.stringify({
      event: "geo_cache",
      hit: cacheHit,
      key: geoCacheKey(lat, lng, radiusMiles, cuisineType, chainOnly),
      restaurants: restaurants.length,
      fetchMs,
      scoringMs: totalMs - fetchMs,
      totalMs,
    }),
  );

  return { data, total };
}

// ─── Service: GET /api/restaurants/[id]/menu ──────────────────────────────────

export async function getRestaurantMenu(
  restaurantId: string,
): Promise<MenuResponse | null> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      menuItems: {
        orderBy: { name: "asc" },
        include: {
          macroEstimates: {
            orderBy: { estimatedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!restaurant) return null;

  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    menuItems: restaurant.menuItems.map((item) => {
      const estimate = item.macroEstimates[0] ?? null;
      return {
        id: item.id,
        name: item.name,
        ...(item.description !== null
          ? { description: item.description }
          : {}),
        ...(item.category !== null ? { category: item.category } : {}),
        ...(item.price !== null ? { price: item.price } : {}),
        macros: estimate
          ? {
              calories: estimate.calories,
              proteinG: estimate.proteinG,
              carbsG: estimate.carbsG,
              fatG: estimate.fatG,
              confidence: estimate.confidence,
              hadPhoto: estimate.hadPhoto,
              estimatedAt: estimate.estimatedAt.toISOString(),
            }
          : null,
      };
    }),
  };
}
