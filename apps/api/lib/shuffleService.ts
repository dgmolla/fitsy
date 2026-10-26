import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { MACRO_DIMENSIONS, macroWinnerSqlOrder, type ShuffleResponse } from '@fitsy/shared';
import { prisma } from './restaurantService';
import { nearbyBoundarySql, nearbyDistanceSql } from './restaurantQuerySql';
import { macroScoreSumSql } from './macroScoreSql';
import { restaurantAvailability } from './restaurantHours';
import { SHUFFLE_WEIGHT_POWER, emptyShuffleResponse, shuffleMacroCaps, shuffleMeta, shufflePaidDetails, shuffleStages, type ShufflePick } from './shuffleSelection';
import type { ShuffleParams } from './shuffleParams';

type Nearby = Prisma.RestaurantGetPayload<object> & { distanceMiles: number };

/** Search's geo predicates and denormalized nutrition, with every eligible dish in the lottery. */
export async function findShuffle(params: ShuffleParams, entitled: boolean, now = new Date()): Promise<ShuffleResponse> {
  const stages = shuffleStages(params.radiusMiles), maxRadius = stages.at(-1)!.radiusMiles;
  const cuisine = params.cuisineType === undefined ? Prisma.empty
    : Prisma.sql`AND ${params.cuisineType} = ANY(r."cuisineTags")`;
  const nearby = await prisma.$queryRaw<Nearby[]>`
    SELECT r.*, ${nearbyDistanceSql(params.lat, params.lng)} AS "distanceMiles"
    FROM "Restaurant" r WHERE ${nearbyBoundarySql(params.lat, params.lng, maxRadius)} ${cuisine}
  `;
  const restaurants = new Map(nearby.filter(r => restaurantAvailability(r.openingHours, now) !== 'closed').map(r => [r.id, r]));
  const targets = entitled ? params.targets : {};
  const seed = params.seed ?? randomUUID();
  for (const stage of stages) {
    const ids = [...restaurants.values()].filter(r => r.distanceMiles <= stage.radiusMiles).map(r => r.id);
    if (!ids.length) continue;
    const caps = shuffleMacroCaps(targets, stage.tolerance, entitled ? params.maxCalories : undefined);
    const filters = MACRO_DIMENSIONS.flatMap(key => [
      Prisma.sql`AND ${Prisma.raw(`m."${key}"`)} >= 0`,
      Prisma.sql`AND ${Prisma.raw(`m."${key}"`)} < 'Infinity'::double precision`,
      ...(caps[key] === undefined ? [] : [Prisma.sql`AND ${Prisma.raw(`m."${key}"`)} <= ${caps[key]}::double precision`]),
    ]);
    if (params.dietary !== undefined) filters.push(Prisma.sql`AND ${params.dietary} = ANY(m."dietaryTags")`);
    if (entitled && params.excludeRecent.length) filters.push(Prisma.sql`AND NOT (m.id = ANY(${params.excludeRecent}::text[]))`);
    // An exponential race gives weight=(1+scoreSum)^-4 without LIMIT bias or a pool in JS memory.
    // Match shufflePriority's 48-bit uniform exactly, keeping ln's argument strictly between 0 and 1.
    const rows = await prisma.$queryRaw<ShufflePick[]>`
      WITH candidates AS MATERIALIZED (
        SELECT m.id, m.name, m."restaurantId", m.calories, m."proteinG", m."carbsG", m."fatG",
          ${macroScoreSumSql(targets)} AS "scoreSum"
        FROM "MenuItem" m WHERE m."restaurantId" = ANY(${ids}::text[]) AND m."retiredAt" IS NULL
          ${Prisma.join(filters, ' ')}
      ), picked AS (
        SELECT * FROM candidates c ORDER BY
          -ln(((('x' || substr(md5(${seed}::text || ':' || c.id), 1, 12))::bit(48)::bigint)::double precision + 1)
            / 281474976710657::double precision) * power(1 + c."scoreSum", ${SHUFFLE_WEIGHT_POWER}), c.id LIMIT 1
      )
      SELECT picked.*, e.confidence, e.source FROM picked LEFT JOIN LATERAL (
        SELECT e.confidence, e.source FROM "MacroEstimate" e WHERE e."menuItemId" = picked.id
        ORDER BY ${Prisma.raw(macroWinnerSqlOrder('e'))} LIMIT 1
      ) e ON true
    `;
    const pick = rows[0];
    if (!pick) continue;
    const r = restaurants.get(pick.restaurantId)!;
    const distanceMiles = Math.round(r.distanceMiles * 100) / 100;
    return {
      data: {
        restaurant: { id: r.id, name: r.name, address: r.address, lat: r.lat, lng: r.lng, distanceMiles,
          cuisineTags: r.cuisineTags, chainFlag: r.chainFlag,
          ...(r.photoUrl === null ? {} : { photoUrl: r.photoUrl }), ...(r.rating === null ? {} : { rating: r.rating }),
          ...(r.priceLevel === null ? {} : { priceLevel: r.priceLevel }), dietaryOptions: r.dietaryOptions },
        ...shufflePaidDetails(pick, entitled),
        distanceMiles, availability: restaurantAvailability(r.openingHours, now) === 'open' ? 'open' : 'unknown',
      },
      meta: shuffleMeta(entitled, stage),
    };
  }
  return emptyShuffleResponse(entitled, stages.at(-1)!);
}
