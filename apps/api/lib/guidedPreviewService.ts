import { Prisma } from '@prisma/client';
import { activeTarget, MACRO_DIMENSIONS, macroWinnerSqlOrder,
  type GuidedPreviewResponse, type MacroTargets } from '@fitsy/shared';
import { prisma, DISTANCE_WEIGHT, restaurantResultFromRow, type ScoredRow } from './restaurantService';
import { macroScoreSumSql } from './macroScoreSql';
import { nearbyBoundarySql, nearbyDistanceSql, restaurantQuerySql } from './restaurantQuerySql';

export interface GuidedPreviewParams {
  lat: number;
  lng: number;
  targets: MacroTargets;
  query?: string | undefined;
  selectedItemId?: string | undefined;
}

interface PreviewRow extends ScoredRow {
  nearbyDishCount: number;
}

/** Rank relevant meals by the same targets as main search, without hard macro cutoffs. */
export function guidedPreviewSql({ lat, lng, targets, query }: GuidedPreviewParams): Prisma.Sql {
  const text = restaurantQuerySql(query);
  const dimensions = MACRO_DIMENSIONS.filter(key => activeTarget(targets[key]));
  const queryFilter = text.matches(Prisma.sql`(SELECT "hasDishMatches" FROM query_context)`, Prisma.sql`m."dishMatches"`,
    Prisma.sql`m."restaurantMatches"`, Prisma.sql`m."exactRestaurant"`);
  const orderKey = dimensions.length ? Prisma.sql`m."scoreSum" + ${DISTANCE_WEIGHT}::double precision * m."distanceMiles"`
    : Prisma.sql`m."distanceMiles"`;
  return Prisma.sql`
    WITH nearby_restaurants AS MATERIALIZED (
      SELECT r.*, ${nearbyDistanceSql(lat, lng)} AS "distanceMiles",
        (${text.restaurant()} OR ${text.cuisine()}) AS "restaurantMatches", ${text.exactRestaurant()} AS "exactRestaurant"
      FROM "Restaurant" r WHERE ${nearbyBoundarySql(lat, lng, 3)}
    ), area_menu AS MATERIALIZED (
      SELECT m.id AS "menuItemId", m."restaurantId", m.name AS "itemName",
        m.calories, m."proteinG", m."carbsG", m."fatG",
        r."distanceMiles", r."restaurantMatches", r."exactRestaurant",
        ${macroScoreSumSql(targets)} AS "scoreSum", ${text.dish()} AS "dishMatches"
      FROM "MenuItem" m JOIN nearby_restaurants r ON r.id = m."restaurantId"
      WHERE m.calories IS NOT NULL AND m."proteinG" IS NOT NULL
        AND m."carbsG" IS NOT NULL AND m."fatG" IS NOT NULL
    ), query_context AS MATERIALIZED (
      SELECT coalesce(bool_or("dishMatches"), false) AS "hasDishMatches" FROM area_menu
    ), relevant AS MATERIALIZED (
      SELECT m.*, ${orderKey} AS "orderKey"
      FROM area_menu m
      WHERE ${queryFilter}
    ), winners AS (
      SELECT DISTINCT ON ("restaurantId") * FROM relevant ORDER BY "restaurantId", "scoreSum", "menuItemId"
    ), picks AS MATERIALIZED (
      SELECT * FROM winners ORDER BY "orderKey", "restaurantId" LIMIT 3
    ), counts AS (
      SELECT (SELECT count(*)::integer FROM area_menu) AS "nearbyDishCount"
    )
    SELECT counts.*, p.*, r.name, r.address, r.lat, r.lng, r."cuisineTags", r."chainFlag", r."photoUrl",
      r.rating, r."priceLevel", r."dietaryOptions", e.confidence, e.source
    FROM counts LEFT JOIN picks p ON true LEFT JOIN nearby_restaurants r ON r.id = p."restaurantId"
    LEFT JOIN LATERAL (
      SELECT e.confidence, e.source FROM "MacroEstimate" e WHERE e."menuItemId" = p."menuItemId"
      ORDER BY ${Prisma.raw(macroWinnerSqlOrder('e'))} LIMIT 1
    ) e ON true
    ORDER BY p."orderKey", p."restaurantId"
  `;
}

export async function findGuidedPreview(params: GuidedPreviewParams): Promise<GuidedPreviewResponse> {
  const rows = await prisma.$queryRaw<PreviewRow[]>(guidedPreviewSql(params));
  const counts = rows[0]!;
  const targetsActive = MACRO_DIMENSIONS.some(key => activeTarget(params.targets[key]));
  return {
    data: rows.filter(row => row.restaurantId != null).map(row => restaurantResultFromRow(row, targetsActive, true)),
    meta: {
      nearbyDishCount: counts.nearbyDishCount,
      radiusMiles: 3,
      // Explicit null disables numerical proof in older clients as well.
      goalMatch: null,
    },
  };
}
