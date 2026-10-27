import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

export interface SearchShuffle {
  seed: string;
  excludeRestaurantIds: string[];
}

/** Restaurant IDs, never dish IDs. Bound client input before querying or reconciling billing. */
export function parseSearchShuffle(params: URLSearchParams, cursorSeed?: string): SearchShuffle | undefined {
  const single = (key: string) => {
    const values = params.getAll(key);
    if (values.length > 1 || values[0]?.trim() === '') throw Error(`Invalid ${key}`);
    return values[0];
  };
  const flag = single('shuffle'), seed = single('seed'), excluded = single('excludeRestaurantIds');
  if (flag !== undefined && flag !== '0' && flag !== '1') throw Error('Invalid shuffle flag');
  if (flag !== '1') {
    if (seed !== undefined || excluded !== undefined) throw Error('Shuffle options require shuffle=1');
    return undefined;
  }
  if (seed !== undefined && seed.length > 100) throw Error('seed must be 100 characters or fewer');
  if (excluded !== undefined && excluded.length > 128_999) throw Error('excludeRestaurantIds is too long');
  const excludeRestaurantIds = [...new Set(excluded?.split(',') ?? [])].sort();
  if (excludeRestaurantIds.length > 1000 || excludeRestaurantIds.some(id => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    throw Error('excludeRestaurantIds must contain at most 1000 comma-separated restaurant ids');
  }
  return { seed: seed ?? cursorSeed ?? randomUUID(), excludeRestaurantIds };
}

/** Uniform seeded order in each group. Previously shown rows only fill a shortage of new rows. */
export function shuffleSearchOrder(shuffle: SearchShuffle): Prisma.Sql {
  return Prisma.sql`(CASE WHEN r.id = ANY(${shuffle.excludeRestaurantIds}::text[]) THEN 1 ELSE 0 END
    + (('x' || substr(md5(${shuffle.seed}::text || ':' || r.id), 1, 12))::bit(48)::bigint)::double precision
      / 281474976710656::double precision)`;
}
