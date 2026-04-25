import { Prisma, PrismaClient } from "@prisma/client";
import { hasTargets, type MacroTargets } from "./macroScoring";
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
  dietary?: string | undefined;
  maxPriceLevel?: string | undefined;
  minRating?: number | undefined;
  limit: number;
}

// ─── Price level helpers ──────────────────────────────────────────────────────

const PRICE_LEVEL_ORDER = ["$", "$$", "$$$", "$$$$"] as const;

function allowedPriceLevels(maxPriceLevel: string): string[] {
  const idx = PRICE_LEVEL_ORDER.indexOf(
    maxPriceLevel as (typeof PRICE_LEVEL_ORDER)[number],
  );
  return idx >= 0
    ? (PRICE_LEVEL_ORDER.slice(0, idx + 1) as unknown as string[])
    : (PRICE_LEVEL_ORDER as unknown as string[]);
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

// ─── Raw row shape returned by the DISTINCT ON query ──────────────────────────

interface ScoredRow {
  restaurantId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  cuisineTags: string[];
  chainFlag: boolean;
  photoUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  dietaryOptions: string[];
  menuItemId: string;
  itemName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  scoreSum: number;
  distanceMiles: number;
}

// ─── Service: GET /api/restaurants ───────────────────────────────────────────

export async function findNearbyRestaurants(
  params: NearbyRestaurantsParams,
): Promise<{ data: RestaurantResult[]; total: number }> {
  const {
    lat,
    lng,
    radiusMiles,
    targets,
    cuisineType,
    chainOnly,
    dietary,
    maxPriceLevel,
    minRating,
    limit,
  } = params;

  const startMs = Date.now();

  const { latMin, latMax, lngMin, lngMax } = computeBoundingBox(
    lat,
    lng,
    radiusMiles,
  );

  const targetsActive = hasTargets(targets);
  const tCal = targets.calories ?? null;
  const tProt = targets.proteinG ?? null;
  const tCarb = targets.carbsG ?? null;
  const tFat = targets.fatG ?? null;

  // Dynamic filter fragments — composed via Prisma.sql for safe parameter binding.
  const filterFrags: Prisma.Sql[] = [];
  if (cuisineType !== undefined) {
    filterFrags.push(Prisma.sql`AND ${cuisineType} = ANY(r."cuisineTags")`);
  }
  if (chainOnly !== undefined) {
    filterFrags.push(Prisma.sql`AND r."chainFlag" = ${chainOnly}`);
  }
  if (dietary !== undefined) {
    filterFrags.push(
      Prisma.sql`AND ${`has_${dietary}`} = ANY(r."dietaryOptions")`,
    );
  }
  if (maxPriceLevel !== undefined) {
    filterFrags.push(
      Prisma.sql`AND r."priceLevel" IN (${Prisma.join(allowedPriceLevels(maxPriceLevel))})`,
    );
  }
  if (minRating !== undefined) {
    filterFrags.push(Prisma.sql`AND r.rating >= ${minRating}`);
  }
  const filters = filterFrags.length > 0 ? Prisma.join(filterFrags, " ") : Prisma.empty;

  // Match score: sum of normalized squared diffs for each active target dimension.
  // When a target is NULL/0, its term contributes 0 — so "no targets" falls through
  // to sort by a tiebreaker (menu item id) inside each restaurant.
  //
  // CROSS JOIN LATERAL picks ONE winning item per restaurant directly: for each
  // bbox-passing restaurant, the inner subquery scores its menu items and returns
  // the top-1. Avoids materializing the full Restaurant×MenuItem×MacroEstimate
  // join, and frees the planner to use Restaurant_lat_lng_idx for the bbox
  // filter (DISTINCT ON forced a pkey walk to preserve r.id ordering).
  const rows = await prisma.$queryRaw<ScoredRow[]>`
    SELECT
      r.id            AS "restaurantId",
      r.name          AS name,
      r.address       AS address,
      r.lat           AS lat,
      r.lng           AS lng,
      r."cuisineTags" AS "cuisineTags",
      r."chainFlag"   AS "chainFlag",
      r."photoUrl"    AS "photoUrl",
      r.rating        AS rating,
      r."priceLevel"  AS "priceLevel",
      r."dietaryOptions" AS "dietaryOptions",
      best."menuItemId",
      best."itemName",
      best.calories,
      best."proteinG",
      best."carbsG",
      best."fatG",
      best.confidence,
      best."scoreSum",
      (
        sqrt(
          power(r.lat - ${lat}::double precision, 2)
          + power((r.lng - ${lng}::double precision) * cos(${lat}::double precision * pi() / 180), 2)
        ) * 69
      ) AS "distanceMiles"
    FROM "Restaurant" r
    CROSS JOIN LATERAL (
      SELECT
        m.id            AS "menuItemId",
        m.name          AS "itemName",
        e.calories      AS calories,
        e."proteinG"    AS "proteinG",
        e."carbsG"      AS "carbsG",
        e."fatG"        AS "fatG",
        e.confidence    AS confidence,
        (
          CASE WHEN ${tCal}::double precision > 0
               THEN power((e.calories - ${tCal}::double precision) / ${tCal}::double precision, 2)
               ELSE 0 END
          + CASE WHEN ${tProt}::double precision > 0
               THEN power((e."proteinG" - ${tProt}::double precision) / ${tProt}::double precision, 2)
               ELSE 0 END
          + CASE WHEN ${tCarb}::double precision > 0
               THEN power((e."carbsG" - ${tCarb}::double precision) / ${tCarb}::double precision, 2)
               ELSE 0 END
          + CASE WHEN ${tFat}::double precision > 0
               THEN power((e."fatG" - ${tFat}::double precision) / ${tFat}::double precision, 2)
               ELSE 0 END
        )               AS "scoreSum"
      FROM "MenuItem" m
      JOIN "MacroEstimate" e ON e."menuItemId" = m.id
      WHERE m."restaurantId" = r.id
      ORDER BY "scoreSum" ASC, m.id ASC
      LIMIT 1
    ) AS best
    WHERE r.lat BETWEEN ${latMin} AND ${latMax}
      AND r.lng BETWEEN ${lngMin} AND ${lngMax}
      ${filters}
      AND (
        sqrt(
          power(r.lat - ${lat}::double precision, 2)
          + power((r.lng - ${lng}::double precision) * cos(${lat}::double precision * pi() / 180), 2)
        ) * 69
      ) <= ${radiusMiles}::double precision
    ORDER BY
      CASE WHEN ${targetsActive}::boolean THEN best."scoreSum" ELSE NULL END ASC NULLS LAST,
      "distanceMiles" ASC
    LIMIT ${limit}
  `;

  const total = rows.length;
  const paginated = rows;

  const data: RestaurantResult[] = paginated.map((r) => ({
    id: r.restaurantId,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    distanceMiles: Math.round(r.distanceMiles * 100) / 100,
    cuisineTags: r.cuisineTags,
    chainFlag: r.chainFlag,
    ...(r.photoUrl ? { photoUrl: r.photoUrl } : {}),
    ...(r.rating !== null ? { rating: r.rating } : {}),
    ...(r.priceLevel !== null ? { priceLevel: r.priceLevel } : {}),
    ...(r.dietaryOptions.length > 0 ? { dietaryOptions: r.dietaryOptions } : {}),
    bestMatch: {
      menuItemId: r.menuItemId,
      name: r.itemName,
      calories: r.calories,
      proteinG: r.proteinG,
      carbsG: r.carbsG,
      fatG: r.fatG,
      confidence: r.confidence,
      matchScore: targetsActive
        ? Math.round(Math.sqrt(r.scoreSum) * 10000) / 10000
        : Infinity,
    },
  }));

  const totalMs = Date.now() - startMs;

  console.log(
    JSON.stringify({
      event: "search_query",
      restaurants: total,
      hasTargets: targetsActive,
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
