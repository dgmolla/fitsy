/**
 * Hex Assignment (S-137)
 *
 * Assigns Overture restaurants to H3 hex cells for batch processing
 * and checkpointing. Each restaurant maps to exactly one hex — no
 * duplicates, no lost records.
 *
 * Hexes are for processing batches and checkpointing — not for discovery.
 *
 * Resolution 7: ~5.16 km² per hex, ~150-350 restaurants per hex in dense urban.
 */

import { latLngToCell } from "h3-js";
import type { OvertureRestaurant } from "./overture-discovery";

const DEFAULT_RESOLUTION = 7;

/**
 * Assign each restaurant to its H3 hex cell.
 *
 * @param restaurants - Array of Overture restaurants with lat/lng
 * @param resolution  - H3 resolution (default 7)
 * @returns Map from hexId to the restaurants in that hex
 */
export function assignToHexes(
  restaurants: OvertureRestaurant[],
  resolution: number = DEFAULT_RESOLUTION,
): Map<string, OvertureRestaurant[]> {
  const hexMap = new Map<string, OvertureRestaurant[]>();

  for (const restaurant of restaurants) {
    const hexId = latLngToCell(restaurant.lat, restaurant.lng, resolution);
    const bucket = hexMap.get(hexId);
    if (bucket) {
      bucket.push(restaurant);
    } else {
      hexMap.set(hexId, [restaurant]);
    }
  }

  return hexMap;
}
