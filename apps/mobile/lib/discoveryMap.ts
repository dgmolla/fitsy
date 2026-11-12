import type { RestaurantResult } from '@fitsy/shared';

/** Reject unusable provider coordinates rather than placing a restaurant at the origin. */
export function hasMapCoordinate(restaurant: RestaurantResult): boolean {
  return Number.isFinite(restaurant.lat) && Number.isFinite(restaurant.lng) &&
    Math.abs(restaurant.lat) <= 90 && Math.abs(restaurant.lng) <= 180 &&
    (restaurant.lat !== 0 || restaurant.lng !== 0);
}

export function mapRestaurantLabel(restaurant: RestaurantResult): string {
  const cuisine = restaurant.cuisineTags.map(tag => tag.trim()).filter(Boolean).join(', ');
  return `${restaurant.name} · ${cuisine || 'Restaurant'}`;
}

// Existing Unicode emoji only; unknown provider categories retain the utensils fallback.
const CUISINE_EMOJI: ReadonlyArray<readonly [RegExp, string]> = [
  [/sushi|japanese/i, '🍣'], [/pizza|italian/i, '🍕'], [/mexican|taco/i, '🌮'],
  [/sandwich|deli/i, '🥪'], [/burger|american/i, '🍔'], [/chinese/i, '🥡'],
  [/korean/i, '🍚'], [/thai|indian/i, '🍛'], [/vietnamese|noodle|ramen/i, '🍜'],
  [/mediterranean|greek|middle eastern/i, '🥙'], [/seafood|fish/i, '🐟'],
  [/vegan|vegetarian|salad/i, '🥗'], [/bakery|french/i, '🥐'], [/breakfast|brunch/i, '🥞'],
];

export function mapCuisineEmoji(restaurant: RestaurantResult): string {
  const categories = restaurant.cuisineTags.join(' ');
  return CUISINE_EMOJI.find(([match]) => match.test(categories))?.[1] ?? '🍴';
}
