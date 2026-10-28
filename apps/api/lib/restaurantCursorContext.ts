import { createHash } from 'node:crypto';
import { activeTarget, MACRO_DIMENSIONS, type MacroTargets } from '@fitsy/shared';
import type { SearchShuffle } from './shuffleSearch';

export interface RestaurantSearchContext {
  lat: number;
  lng: number;
  radiusMiles: number;
  targets: MacroTargets;
  goalMatched?: boolean;
  query?: string | undefined;
  cuisineType?: string | undefined;
  chainOnly?: boolean | undefined;
  dietary?: string | undefined;
  maxPriceLevel?: string | undefined;
  minRating?: number | undefined;
  shuffle?: SearchShuffle;
}

/** Bind shuffled pages to their order and filters; retain the legacy ranked-context guard. */
export function restaurantCursorContext(params: RestaurantSearchContext): string | undefined {
  const targets = MACRO_DIMENSIONS.filter(key => activeTarget(params.targets[key])).map(key => [key, params.targets[key]]);
  if (!params.shuffle && (!params.goalMatched || !targets.length)) return undefined;
  return createHash('sha256').update(JSON.stringify({
    policy: params.shuffle ? 'shuffle-search-v1' : 'target-ranked-v1', goalMatched: !!params.goalMatched,
    ...(params.shuffle ? { shuffle: params.shuffle } : {}), lat: params.lat, lng: params.lng, radiusMiles: params.radiusMiles,
    targets, query: params.query?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '',
    cuisineType: params.cuisineType ?? null, chainOnly: params.chainOnly ?? null, dietary: params.dietary ?? null,
    maxPriceLevel: params.maxPriceLevel ?? null, minRating: params.minRating ?? null,
  })).digest('hex');
}
