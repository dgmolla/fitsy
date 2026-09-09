import { Prisma, PrismaClient } from "@prisma/client";
import { hasTargets, type MacroTargets } from "./macroScoring";
import { macroScoreSumSql } from "./macroScoreSql";
import { macroWinnerSqlOrder } from "@fitsy/shared";
import { type RestaurantResult, type MenuResponse } from "@fitsy/shared";

import { getMenuPage, type MenuPageOptions } from "./restaurantMenuService";

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
 * proximity. When the user has targets the ORDER BY is
 * `scoreSum + DISTANCE_WEIGHT * distanceMiles` — so macro fit drives the
 * ranking and distance only breaks near-ties.
 *
 * `scoreSum` is a sum of normalized squared diffs (typical range 0–2 within
 * the radius); `distanceMiles` ranges 0–`radiusMiles`. At the default `0.05`,
 * a full 3-mi traversal adds 0.15 to the composite — enough to break ties
 * between similarly-fitting items, but far less than the gap between a real
 * macro match and a wildly-off item (which sits at scoreSum ~2+).
 */
const RAW_DISTANCE_WEIGHT = process.env["SEARCH_DISTANCE_WEIGHT"];
const DISTANCE_WEIGHT: number =
  RAW_DISTANCE_WEIGHT !== undefined && !Number.isNaN(Number(RAW_DISTANCE_WEIGHT))
    ? Number(RAW_DISTANCE_WEIGHT)
    : 0.05;

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
  /**
   * Free-text query. Matched (case-insensitive substring) against the
   * restaurant name, its cuisineTags, and its menu item names/descriptions.
   * Acts as a filter only — results are still ranked by the macro+distance
   * composite. All matching is correlated to the geographically-bounded
   * candidate set, so cost scales with restaurants-in-radius, not table size.
   */
  query?: string | undefined;
  limit: number;
  /**
   * Decoded cursor — { id, orderKey } from the last item on the previous
   * page. `orderKey` matches the composite sort expression
   * (`scoreSum + DISTANCE_WEIGHT * distance` with targets, distance-only
   * without). Legacy cursors encoded as { id, distanceMiles } still decode
   * correctly — see decodeCursor.
   */
  cursor?: PaginationCursor | undefined;
}

// ─── Cursor encoding ──────────────────────────────────────────────────────────

export interface PaginationCursor {
  id: string;
  /** The active sort key for the row (composite or distance, depending on mode). */
  orderKey: number;
  /** Exact PostgreSQL float representation, preserved across Prisma's JSON transport. */
  orderKeyText?: string;
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
      const obj = parsed as { id: string; orderKey?: unknown; orderKeyText?: unknown; distanceMiles?: unknown };
      // Prefer `orderKey`; fall back to legacy `distanceMiles`.
      const rawKey =
        typeof obj.orderKey === "number" && isFinite(obj.orderKey)
          ? obj.orderKey
          : typeof obj.distanceMiles === "number" && isFinite(obj.distanceMiles)
            ? obj.distanceMiles
            : null;
      if (rawKey === null) return null;
      const out: PaginationCursor = { id: obj.id, orderKey: rawKey };
      if (obj.orderKeyText !== undefined) {
        if (typeof obj.orderKeyText !== "string" || !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(obj.orderKeyText)
          || !Number.isFinite(Number(obj.orderKeyText))
          || (Number(obj.orderKeyText) === 0 && /[1-9]/.test(obj.orderKeyText.split(/e/i)[0]!))) return null;
        out.orderKeyText = obj.orderKeyText;
      }
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

// ─── Text search config ───────────────────────────────────────────────────────

/**
 * Postgres full-text-search dictionary for free-text matching.
 *
 * We match with `to_tsvector(config, target) @@ plainto_tsquery(config, query)`.
 * FTS tokenizes both sides into lexemes and requires *all* query lexemes to be
 * present (AND semantics), which is precise for multi-word queries and immune
 * to substring-in-word noise — validated against prod data:
 *   "chick fil a" → Chick-fil-A ✓ (tokenizes the hyphenated name)
 *                   but NOT "Lil' Chick Bowl" / "Chick'n Wrap" ✓
 *   "ramen" → "Birria Ramen" ✓ but NOT "Sacramento" / "Rama Thai" ✓
 * The `english` dictionary also stems, so "tacos"→taco, "burritos"→burrito.
 * (FTS does not do typo correction; that's a future trigram-assist job.)
 * Override via SEARCH_TS_CONFIG.
 */
const TEXT_SEARCH_CONFIG = process.env["SEARCH_TS_CONFIG"] ?? "english";

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
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  scoreSum: number;
  distanceMiles: number;
  /** Active sort key — composite (scoreSum + w·distance) or distance-only. */
  orderKey: number;
  orderKeyText?: string;
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
    query,
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
  // Free-text filter. References only `r` (plus correlated subqueries on
  // r.id), so the planner can prune Restaurant rows before the macro LATERAL
  // runs. Matching is bounded to the geographic candidate set, so cost tracks
  // restaurants-in-radius rather than total table size.
  //
  // Full-text matches restaurant name, cuisineTags, and menu item *names* —
  // NOT descriptions (long prose, low precision). FTS tokenization handles
  // spacing/punctuation ("chick fil a" → "Chick-fil-A") and its AND-of-lexemes
  // semantics keep multi-word queries precise (no "Lil' Chick Bowl" noise).
  const queryText = query !== undefined && query !== "" ? query : null;

  // to_tsvector(config, target) @@ plainto_tsquery(config, query). plainto_tsquery
  // safely parses arbitrary user text into a lexeme AND-query (no escaping/
  // injection concerns). Reused for name / cuisine / dish.
  const fts = (target: Prisma.Sql): Prisma.Sql =>
    Prisma.sql`to_tsvector(${TEXT_SEARCH_CONFIG}::regconfig, ${target}) @@ plainto_tsquery(${TEXT_SEARCH_CONFIG}::regconfig, ${queryText})`;

  // True (per row) when the restaurant *itself* is on-topic for the query
  // (name or cuisine matches) — in which case every one of its dishes is
  // relevant. Reused by the outer gate and the macro LATERAL's item filter so
  // both agree on what "relevant" means.
  const restaurantMatchesQuery = Prisma.sql`(
    ${fts(Prisma.sql`r.name`)}
    OR ${fts(Prisma.sql`array_to_string(r."cuisineTags", ' ')`)}
  )`;

  if (queryText !== null) {
    filterFrags.push(Prisma.sql`AND (
      ${restaurantMatchesQuery}
      OR EXISTS (
        SELECT 1 FROM "MenuItem" mi
        WHERE mi."restaurantId" = r.id
          AND ${fts(Prisma.sql`mi.name`)}
      )
    )`);
  }

  // When a text query is active, the dish we display and macro-score for each
  // restaurant must come from the query-relevant set — otherwise a "ramen"
  // search can surface a restaurant for its Birria Ramen but show (and rank by)
  // an unrelated best-macro kabob. If the restaurant itself matches (name /
  // cuisine) every dish is relevant; otherwise only dishes whose name matches.
  // So `best` becomes "the query-matching dish that best fits the user's
  // macros," and the restaurant's rank reflects that dish.
  const menuQueryFilter: Prisma.Sql =
    queryText !== null
      ? Prisma.sql`AND (
          ${restaurantMatchesQuery}
          OR ${fts(Prisma.sql`m.name`)}
        )`
      : Prisma.empty;
  // Shared distance expression — reused in SELECT, ORDER BY, and the cursor
  // WHERE filter so all three agree exactly.
  const distanceExpr = Prisma.sql`(
    sqrt(
      power(r.lat - ${lat}::double precision, 2)
      + power((r.lng - ${lng}::double precision) * cos(${lat}::double precision * pi() / 180), 2)
    ) * 69
  )`;

  // Composite ranking expression. When the user has targets, ordering is
  // `scoreSum + DISTANCE_WEIGHT * distance` so good macro matches a bit
  // farther away beat poor matches next door. With no active targets, falls
  // back to distance so we don't tie every row on scoreSum=0.
  const orderKeyExpr: Prisma.Sql = Prisma.sql`(CASE WHEN ${targetsActive}::boolean
        THEN best."scoreSum" + ${DISTANCE_WEIGHT}::double precision * ${distanceExpr}
        ELSE ${distanceExpr}
      END)`;

  // Cursor tie-break: page by (orderKey ASC, id ASC). Only rows strictly
  // after the cursor's (orderKey, id) pass. Aliases from SELECT aren't
  // visible in WHERE, so the expression is repeated here.
  if (cursor !== undefined) {
    filterFrags.push(Prisma.sql`AND (
      ${orderKeyExpr} > ${cursor.orderKeyText ?? cursor.orderKey}::double precision
      OR (
        ${orderKeyExpr} = ${cursor.orderKeyText ?? cursor.orderKey}::double precision
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
  // on the hot path. Limit restaurants first, then select one winning
  // estimate per result so multiple sources cannot duplicate restaurants
  // or consume page slots. Confidence follows the same source as detail.
  const rows = await prisma.$queryRaw<ScoredRow[]>`
    WITH ranked AS MATERIALIZED (
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
        ${macroScoreSumSql(targets)}               AS "scoreSum"
      FROM "MenuItem" m
      WHERE m."restaurantId" = r.id
        AND m.calories IS NOT NULL AND m."proteinG" IS NOT NULL
        AND m."carbsG" IS NOT NULL AND m."fatG" IS NOT NULL
        ${menuQueryFilter}
      ORDER BY "scoreSum" ASC, m.id ASC
      LIMIT 1
    ) AS best
    WHERE r.lat BETWEEN ${latMin} AND ${latMax}
      AND r.lng BETWEEN ${lngMin} AND ${lngMax}
      ${filters}
      AND ${distanceExpr} <= ${radiusMiles}::double precision
    ORDER BY "orderKey" ASC, r.id ASC
    LIMIT ${limit}
    )
    SELECT ranked.*, ranked."orderKey"::text AS "orderKeyText", e.confidence
    FROM ranked
    LEFT JOIN LATERAL (
      SELECT e.confidence FROM "MacroEstimate" e
      WHERE e."menuItemId" = ranked."menuItemId"
      ORDER BY ${Prisma.raw(macroWinnerSqlOrder("e"))}
      LIMIT 1
    ) e ON true
    ORDER BY ranked."orderKey" ASC, ranked."restaurantId" ASC
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
          ...(lastRow.orderKeyText ? { orderKeyText: lastRow.orderKeyText } : {}),
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
      confidence: r.confidence ?? "LOW",
      matchScore: targetsActive
        ? Math.round(Math.sqrt(r.scoreSum) * 10000) / 10000
        : null,
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
  options: MenuPageOptions = {},
): Promise<MenuResponse | null> {
  return getMenuPage(prisma, restaurantId, options);
}
