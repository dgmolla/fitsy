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

// ─── Ranking config ───────────────────────────────────────────────────────────

/**
 * Weight applied to `distanceMiles` when combining macro-fit score with
 * proximity. When unset (env var absent), ranking is pure distance-asc (the
 * historical behavior). When set, the ORDER BY becomes
 * `scoreSum + DISTANCE_WEIGHT * distanceMiles` whenever the user has targets
 * — so a restaurant whose best item fits better can out-rank a closer one
 * whose best item misses.
 *
 * `scoreSum` is a sum of normalized squared diffs (typical range 0–2 within
 * the radius); `distanceMiles` ranges 0–`radiusMiles`. A weight of `0.15`
 * means moving from 0 → 2 miles adds 0.3 to the composite, equivalent to the
 * macro error from being ~17% off on one macro dimension — close items still
 * win all else equal, but macro fit can overcome a couple of miles.
 */
const RAW_DISTANCE_WEIGHT = process.env["SEARCH_DISTANCE_WEIGHT"];
const DISTANCE_WEIGHT: number | null =
  RAW_DISTANCE_WEIGHT !== undefined && !Number.isNaN(Number(RAW_DISTANCE_WEIGHT))
    ? Number(RAW_DISTANCE_WEIGHT)
    : null;

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
  /**
   * Decoded cursor — { id, orderKey } from the last item on the previous
   * page. `orderKey` matches whatever sort expression is active (composite
   * when SEARCH_DISTANCE_WEIGHT is set, else distance-only). Legacy cursors
   * encoded as { id, distanceMiles } still decode correctly — see
   * decodeCursor.
   */
  cursor?: { id: string; orderKey: number } | undefined;
}

// ─── Cursor encoding ──────────────────────────────────────────────────────────

export interface PaginationCursor {
  id: string;
  /** The active sort key for the row (composite or distance, depending on mode). */
  orderKey: number;
  /** Kept for backward compat with cursors encoded before composite ranking. */
  distanceMiles?: number;
}

export function encodeCursor(cursor: PaginationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

export function decodeCursor(raw: string): PaginationCursor | null {
  try {
    const json = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      const obj = parsed as { id: string; orderKey?: unknown; distanceMiles?: unknown };
      // Prefer `orderKey`; fall back to legacy `distanceMiles`.
      const rawKey =
        typeof obj.orderKey === "number" && isFinite(obj.orderKey)
          ? obj.orderKey
          : typeof obj.distanceMiles === "number" && isFinite(obj.distanceMiles)
            ? obj.distanceMiles
            : null;
      if (rawKey === null) return null;
      const out: PaginationCursor = { id: obj.id, orderKey: rawKey };
      if (typeof obj.distanceMiles === "number" && isFinite(obj.distanceMiles)) {
        out.distanceMiles = obj.distanceMiles;
      }
      return out;
    }
    return null;
  } catch {
    return null;
  }
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
  /** Active sort key — composite (scoreSum + w·distance) or distance-only. */
  orderKey: number;
}

// ─── Service: GET /api/restaurants ───────────────────────────────────────────

export async function findNearbyRestaurants(
  params: NearbyRestaurantsParams,
): Promise<{ data: RestaurantResult[]; total: number; nextCursor: string | null }> {
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
    cursor,
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
  // Shared distance expression — reused in SELECT, ORDER BY, and the cursor
  // WHERE filter so all three agree exactly.
  const distanceExpr = Prisma.sql`(
    sqrt(
      power(r.lat - ${lat}::double precision, 2)
      + power((r.lng - ${lng}::double precision) * cos(${lat}::double precision * pi() / 180), 2)
    ) * 69
  )`;

  // Composite ranking expression. When SEARCH_DISTANCE_WEIGHT is unset, this
  // is pure distance (historical behavior). When set, and the user has
  // targets, restaurant ordering becomes `scoreSum + weight * distance` so
  // good macro matches a bit farther away can beat a worse match next door.
  // With no active targets, falls back to distance so we don't tie every row
  // on scoreSum=0.
  const orderKeyExpr: Prisma.Sql =
    DISTANCE_WEIGHT !== null
      ? Prisma.sql`(CASE WHEN ${targetsActive}::boolean
            THEN best."scoreSum" + ${DISTANCE_WEIGHT}::double precision * ${distanceExpr}
            ELSE ${distanceExpr}
          END)`
      : distanceExpr;

  // Cursor tie-break: page by (orderKey ASC, id ASC). Only rows strictly
  // after the cursor's (orderKey, id) pass. Aliases from SELECT aren't
  // visible in WHERE, so the expression is repeated here.
  if (cursor !== undefined) {
    filterFrags.push(Prisma.sql`AND (
      ${orderKeyExpr} > ${cursor.orderKey}::double precision
      OR (
        ${orderKeyExpr} = ${cursor.orderKey}::double precision
        AND r.id > ${cursor.id}
      )
    )`);
  }
  const filters = filterFrags.length > 0 ? Prisma.join(filterFrags, " ") : Prisma.empty;

  // Match score: sum of normalized squared diffs for each active target dimension.
  // When a target is NULL/0, its term contributes 0 — so "no targets" falls through
  // to sort by a tiebreaker (menu item id) inside each restaurant.
  //
  // The inner LATERAL reads macros directly from MenuItem (denormalized in
  // pipeline-utils.ts and audited daily by /api/internal/audit-macro-drift),
  // so it never joins MacroEstimate at the per-item level — a ~100× saving
  // on the hot path. MacroEstimate is joined once per result via a single
  // LEFT JOIN on best."menuItemId" to surface confidence, which still lives
  // on MacroEstimate as part of the audit metadata.
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
      e.confidence    AS confidence,
      best."scoreSum",
      ${distanceExpr} AS "distanceMiles",
      ${orderKeyExpr} AS "orderKey"
    FROM "Restaurant" r
    CROSS JOIN LATERAL (
      SELECT
        m.id            AS "menuItemId",
        m.name          AS "itemName",
        m.calories      AS calories,
        m."proteinG"    AS "proteinG",
        m."carbsG"      AS "carbsG",
        m."fatG"        AS "fatG",
        (
          CASE WHEN ${tCal}::double precision > 0
               THEN power((m.calories - ${tCal}::double precision) / ${tCal}::double precision, 2)
               ELSE 0 END
          + CASE WHEN ${tProt}::double precision > 0
               THEN power((m."proteinG" - ${tProt}::double precision) / ${tProt}::double precision, 2)
               ELSE 0 END
          + CASE WHEN ${tCarb}::double precision > 0
               THEN power((m."carbsG" - ${tCarb}::double precision) / ${tCarb}::double precision, 2)
               ELSE 0 END
          + CASE WHEN ${tFat}::double precision > 0
               THEN power((m."fatG" - ${tFat}::double precision) / ${tFat}::double precision, 2)
               ELSE 0 END
        )               AS "scoreSum"
      FROM "MenuItem" m
      WHERE m."restaurantId" = r.id
        AND m.calories IS NOT NULL
      ORDER BY "scoreSum" ASC, m.id ASC
      LIMIT 1
    ) AS best
    LEFT JOIN "MacroEstimate" e ON e."menuItemId" = best."menuItemId"
    WHERE r.lat BETWEEN ${latMin} AND ${latMax}
      AND r.lng BETWEEN ${lngMin} AND ${lngMax}
      ${filters}
      AND ${distanceExpr} <= ${radiusMiles}::double precision
    ORDER BY "orderKey" ASC, r.id ASC
    LIMIT ${limit}
  `;

  const total = rows.length;
  const paginated = rows;

  // Compute nextCursor from the final row when this page was full. A partial
  // page (fewer rows than the requested limit) means we've exhausted the
  // result set — emit null so the client stops paginating.
  const lastRow = paginated[paginated.length - 1];
  const nextCursor =
    paginated.length === limit && lastRow !== undefined
      ? encodeCursor({
          id: lastRow.restaurantId,
          orderKey: lastRow.orderKey,
          distanceMiles: lastRow.distanceMiles,
        })
      : null;

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
      paginated: cursor !== undefined,
    }),
  );

  return { data, total, nextCursor };
}

// ─── Service: GET /api/restaurants/[id]/menu ──────────────────────────────────

export async function getRestaurantMenu(
  restaurantId: string,
): Promise<MenuResponse | null> {
  // Macros (calories/proteinG/carbsG/fatG) live on MenuItem itself.
  // MacroEstimate stays as the audit log — we still pull confidence,
  // hadPhoto, and estimatedAt from it for the menu detail screen.
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      menuItems: {
        orderBy: { name: "asc" },
        include: {
          macroEstimates: {
            orderBy: { estimatedAt: "desc" },
            take: 1,
            select: {
              confidence: true,
              hadPhoto: true,
              estimatedAt: true,
            },
          },
        },
      },
    },
  });

  if (!restaurant) return null;

  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    ...(restaurant.rating !== null ? { rating: restaurant.rating } : {}),
    ...(restaurant.userRatingCount !== null ? { userRatingCount: restaurant.userRatingCount } : {}),
    menuItems: restaurant.menuItems.map((item) => {
      const estimate = item.macroEstimates[0] ?? null;
      const hasMacros =
        item.calories !== null &&
        item.proteinG !== null &&
        item.carbsG !== null &&
        item.fatG !== null;
      return {
        id: item.id,
        name: item.name,
        ...(item.description !== null
          ? { description: item.description }
          : {}),
        ...(item.category !== null ? { category: item.category } : {}),
        ...(item.price !== null ? { price: item.price } : {}),
        macros:
          hasMacros && estimate
            ? {
                calories: item.calories!,
                proteinG: item.proteinG!,
                carbsG: item.carbsG!,
                fatG: item.fatG!,
                confidence: estimate.confidence,
                hadPhoto: estimate.hadPhoto,
                estimatedAt: estimate.estimatedAt.toISOString(),
              }
            : null,
      };
    }),
  };
}
