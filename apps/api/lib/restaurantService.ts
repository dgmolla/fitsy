import { PrismaClient } from "@prisma/client";
import {
  computeMatchScore,
  bestScoredItem,
  hasTargets,
  type MacroTargets,
  type ScoredItem,
} from "./macroScoring";
import type {
  RestaurantsResponse,
  RestaurantResult,
  MenuResponse,
} from "@fitsy/shared";

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
  // Equirectangular approximation — sufficient for short distances
  const latDiff = lat2 - lat1;
  const lngDiff = (lng2 - lng1) * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 69;
}

// ─── Service: GET /api/restaurants ───────────────────────────────────────────

export async function findNearbyRestaurants(
  params: NearbyRestaurantsParams,
): Promise<{ data: RestaurantResult[]; total: number }> {
  const { lat, lng, radiusMiles, targets, cuisineType, chainOnly, limit } =
    params;

  const { latMin, latMax, lngMin, lngMax } = computeBoundingBox(
    lat,
    lng,
    radiusMiles,
  );

  const restaurants = await prisma.restaurant.findMany({
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

  // Filter to true radius (bounding box includes corners outside radius)
  const inRadius = restaurants.filter((r) => {
    const dist = computeDistanceMiles(lat, lng, r.lat, r.lng);
    return dist <= radiusMiles;
  });

  const withScores: Array<{
    restaurant: (typeof inRadius)[number];
    distanceMiles: number;
    bestMatch: ScoredItem | null;
  }> = inRadius.map((r) => {
    const distanceMiles = computeDistanceMiles(lat, lng, r.lat, r.lng);

    let bestMatch: ScoredItem | null = null;

    if (hasTargets(targets)) {
      const scoredItems: ScoredItem[] = [];

      for (const item of r.menuItems) {
        const estimate = item.macroEstimates[0];
        if (!estimate) continue;

        const score = computeMatchScore(targets, {
          calories: estimate.calories,
          proteinG: estimate.proteinG,
          carbsG: estimate.carbsG,
          fatG: estimate.fatG,
          confidence: estimate.confidence,
        });

        if (score !== null) {
          scoredItems.push({
            menuItemId: item.id,
            name: item.name,
            macros: {
              calories: estimate.calories,
              proteinG: estimate.proteinG,
              carbsG: estimate.carbsG,
              fatG: estimate.fatG,
              confidence: estimate.confidence,
            },
            score,
          });
        }
      }

      bestMatch = bestScoredItem(scoredItems);
    }

    return { restaurant: r, distanceMiles, bestMatch };
  });

  // Sort: if targets specified, sort by best match score; else sort by distance
  withScores.sort((a, b) => {
    if (hasTargets(targets)) {
      const scoreA = a.bestMatch?.score ?? Infinity;
      const scoreB = b.bestMatch?.score ?? Infinity;
      if (scoreA !== scoreB) return scoreA - scoreB;
    }
    return a.distanceMiles - b.distanceMiles;
  });

  const total = withScores.length;
  const paginated = withScores.slice(0, limit);

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
