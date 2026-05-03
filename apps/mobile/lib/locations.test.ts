/**
 * Sanity tests for the preset LA neighborhood list.
 *
 * Goal: catch typos / out-of-range coordinates that would silently send
 * search to the wrong city. The list is curated by hand so the assertions
 * are deliberately tight — every entry must sit inside a generous LA
 * bounding box (≈ Greater Los Angeles), and names must be unique.
 */
import { PRESET_LOCATIONS } from './locations';

// Greater LA bounding box (very generous — Long Beach to Burbank, Santa
// Monica to Pasadena). If a coordinate ever escapes this box, the entry
// is almost certainly a typo.
const LA_LAT_MIN = 33.7;
const LA_LAT_MAX = 34.3;
const LA_LNG_MIN = -118.7;
const LA_LNG_MAX = -118.1;

describe('PRESET_LOCATIONS', () => {
  it('exports a non-empty list with at least 10 neighborhoods', () => {
    expect(PRESET_LOCATIONS.length).toBeGreaterThanOrEqual(10);
  });

  it('has unique names (no accidental duplicates)', () => {
    const names = PRESET_LOCATIONS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every coordinate sits inside the Greater LA bounding box', () => {
    for (const loc of PRESET_LOCATIONS) {
      expect(loc.lat).toBeGreaterThan(LA_LAT_MIN);
      expect(loc.lat).toBeLessThan(LA_LAT_MAX);
      expect(loc.lng).toBeGreaterThan(LA_LNG_MIN);
      expect(loc.lng).toBeLessThan(LA_LNG_MAX);
    }
  });

  it('every entry has a non-empty trimmed name', () => {
    for (const loc of PRESET_LOCATIONS) {
      expect(loc.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes Silver Lake (matches the hardcoded fallback location)', () => {
    const silverLake = PRESET_LOCATIONS.find((l) => l.name === 'Silver Lake');
    expect(silverLake).toBeDefined();
  });
});
