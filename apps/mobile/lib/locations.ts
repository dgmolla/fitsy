/**
 * Preset LA neighborhoods used for the manual location override.
 *
 * The override exists so users who deny location permission, are in LA but
 * not where GPS reports, or are testing from outside LA can still get
 * meaningful search results without typing a zip code.
 *
 * MVP scope: the app is LA-only, so a fixed list of ~10 hand-picked
 * neighborhoods is sufficient. When the database goes multi-city we'll
 * replace this with autocomplete or a map picker.
 *
 * Coordinates are approximate centroids — they target the heart of each
 * neighborhood within ±0.3 mi so distance-sorted search results match what
 * a tester standing on a street in that neighborhood would expect.
 */

export interface PresetLocation {
  /** Display name shown in the picker sheet and the LocationBar pill. */
  name: string;
  /** Latitude (approximate centroid). */
  lat: number;
  /** Longitude (approximate centroid). */
  lng: number;
}

export const PRESET_LOCATIONS: readonly PresetLocation[] = [
  { name: 'Silver Lake', lat: 34.0868, lng: -118.2706 },
  { name: 'Hollywood', lat: 34.0928, lng: -118.3287 },
  { name: 'West Hollywood', lat: 34.09, lng: -118.3617 },
  { name: 'Echo Park', lat: 34.0782, lng: -118.2606 },
  { name: 'Los Feliz', lat: 34.1075, lng: -118.2929 },
  { name: 'Koreatown', lat: 34.0577, lng: -118.3006 },
  { name: 'DTLA', lat: 34.0407, lng: -118.2468 },
  { name: 'Mid-City', lat: 34.0488, lng: -118.3441 },
  { name: 'Studio City', lat: 34.1436, lng: -118.395 },
  { name: 'Venice', lat: 33.985, lng: -118.4695 },
] as const;
