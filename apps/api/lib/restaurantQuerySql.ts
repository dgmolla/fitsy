import { Prisma } from '@prisma/client';

function column(alias: string, name: string): Prisma.Sql {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('Invalid SQL alias');
  return Prisma.raw(`${alias}.${name}`);
}

// English FTS handles stemming and AND-combines terms; punctuation-separated restaurant names remain searchable.
const TEXT_SEARCH_CONFIG = process.env['SEARCH_TS_CONFIG'] ?? 'english';

export function nearbyDistanceSql(lat: number, lng: number, alias = 'r'): Prisma.Sql {
  const latitude = column(alias, 'lat'), longitude = column(alias, 'lng');
  return Prisma.sql`(sqrt(power(${latitude} - ${lat}::double precision, 2)
    + power((${longitude} - ${lng}::double precision) * cos(${lat}::double precision * pi() / 180), 2)) * 69)`;
}

export function nearbyBoundarySql(lat: number, lng: number, radiusMiles: number, alias = 'r'): Prisma.Sql {
  const latDelta = radiusMiles / 69, lngDelta = radiusMiles / (69 * Math.cos(lat * Math.PI / 180));
  return Prisma.sql`${column(alias, 'lat')} BETWEEN ${lat - latDelta} AND ${lat + latDelta}
    AND ${column(alias, 'lng')} BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}
    AND ${nearbyDistanceSql(lat, lng, alias)} <= ${radiusMiles}::double precision`;
}

/** Dish relevance is decided before target qualification, so a poor-fit craving cannot fall back to unrelated food. */
export function restaurantQuerySql(query: string | undefined) {
  const text = query?.trim().replace(/\s+/g, ' ');
  const fts = (column: Prisma.Sql) => text
    ? Prisma.sql`to_tsvector(${TEXT_SEARCH_CONFIG}::regconfig, ${column}) @@ plainto_tsquery(${TEXT_SEARCH_CONFIG}::regconfig, ${text})`
    : Prisma.sql`false`;
  const restaurant = (alias = 'r') => fts(column(alias, 'name'));
  const cuisine = (alias = 'r') => fts(Prisma.sql`array_to_string(${column(alias, '"cuisineTags"')}, ' ')`);
  const dish = (alias = 'm') => fts(column(alias, 'name'));
  const exactRestaurant = (alias = 'r') => text
    ? Prisma.sql`lower(regexp_replace(trim(${column(alias, 'name')}), '[[:space:]]+', ' ', 'g')) = lower(${text})`
    : Prisma.sql`false`;
  // Intentional area-wide craving policy: a restaurant-name fallback must not replace a searched food with an unrelated dish.
  // A name-only restaurant is omitted when other nearby dishes match; its exact full-name query still selects its menu.
  const matches = (hasDishes: Prisma.Sql, dishMatch: Prisma.Sql, restaurantMatch: Prisma.Sql, exactMatch: Prisma.Sql) => text
    ? Prisma.sql`(${exactMatch} OR CASE WHEN ${hasDishes} THEN ${dishMatch} ELSE ${restaurantMatch} END)`
    : Prisma.sql`true`;
  return { active: !!text, dish, restaurant, cuisine, exactRestaurant, matches };
}
