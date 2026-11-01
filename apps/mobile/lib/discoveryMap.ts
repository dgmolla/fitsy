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
