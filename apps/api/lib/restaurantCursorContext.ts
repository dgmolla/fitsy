import { createHash } from 'node:crypto';
import { activeTarget, MACRO_DIMENSIONS, GOAL_MATCH_POLICY, type MacroTargets } from '@fitsy/shared';

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
}

/** Goal-matched searches bind request-scoped membership/ranking inputs; legacy clients retain legacy cursors. */
export function restaurantCursorContext(params: RestaurantSearchContext): string | undefined {
  const targets = MACRO_DIMENSIONS.filter(key => activeTarget(params.targets[key])).map(key => [key, params.targets[key]]);
  if (!params.goalMatched || !targets.length) return undefined;
  return createHash('sha256').update(JSON.stringify({
    policy: GOAL_MATCH_POLICY, goalMatched: true, lat: params.lat, lng: params.lng, radiusMiles: params.radiusMiles,
    targets, query: params.query?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '',
    cuisineType: params.cuisineType ?? null, chainOnly: params.chainOnly ?? null, dietary: params.dietary ?? null,
    maxPriceLevel: params.maxPriceLevel ?? null, minRating: params.minRating ?? null,
  })).digest('hex');
}
