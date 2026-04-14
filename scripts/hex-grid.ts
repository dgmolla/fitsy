/**
 * Hex Grid Discovery (S-125)
 *
 * Uses Uber's H3 hierarchical hex grid to tile target areas into
 * non-overlapping hex cells. Each hex maps to one Google Places
 * Nearby Search call with a 2km radius.
 *
 * Resolution 7: ~5.16 km² per hex, ~200 restaurants per hex in dense urban.
 * LA metro at res 7 → ~100 hexes.
 */

import { polygonToCells, cellToLatLng } from "h3-js";

export interface HexCell {
  hexId: string;
  lat: number;
  lng: number;
}

/** LA metro restaurant-dense neighborhoods bounding polygon */
const LA_METRO_POLYGON: [number, number][] = [
  [34.15, -118.50], // NW corner
  [34.15, -118.15], // NE
  [33.95, -118.15], // SE
  [33.95, -118.50], // SW
];

const DEFAULT_RESOLUTION = 7;

/**
 * Generate hex cells for a bounding polygon at the given H3 resolution.
 * Returns deterministic output — same inputs always produce same hex IDs.
 */
export function generateHexGrid(
  polygon: [number, number][] = LA_METRO_POLYGON,
  resolution: number = DEFAULT_RESOLUTION,
): HexCell[] {
  // polygon is [lat, lng] order, so isGeoJson=false
  const hexIds = polygonToCells(polygon, resolution, false);
  return hexIds.map((hexId) => {
    const [lat, lng] = cellToLatLng(hexId);
    return { hexId, lat, lng };
  });
}

/**
 * Generate hex cells for a single point with a given radius.
 * Used for backward-compatible single-area mode.
 */
export function generateSingleHex(lat: number, lng: number): HexCell {
  return { hexId: "hex_single", lat, lng };
}
