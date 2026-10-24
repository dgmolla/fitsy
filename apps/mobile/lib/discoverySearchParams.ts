import type { MacroValues } from './macroPresets';
import type { fetchRestaurantsPage } from './apiClient';

/** The first page and pagination always use the same active search inputs. */
export function buildDiscoveryParams(current: MacroValues, lat: number, lng: number, query: string): Parameters<typeof fetchRestaurantsPage>[0] {
  const params: Parameters<typeof fetchRestaurantsPage>[0] = { lat, lng };
  for (const key of ['protein', 'carbs', 'fat', 'calories'] as const) {
    const value = parseFloat(current[key]);
    if (!isNaN(value)) params[key] = value;
  }
  if (query.trim()) params.query = query.trim();
  return params;
}

export function discoveryTargetFlags(current: MacroValues) {
  return {
    has_protein_target: !isNaN(parseFloat(current.protein)),
    has_carbs_target: !isNaN(parseFloat(current.carbs)),
    has_fat_target: !isNaN(parseFloat(current.fat)),
    has_calories_target: !isNaN(parseFloat(current.calories)),
  };
}
