import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chainUsStateCodes } from './chainUsStateCodes.generated';

// Compressed reference avoids feeding a multi-megabyte numeric AST to TypeScript and code-review tools.
type Boundaries = {
  states: { code: string; polygons: { bounds: number[]; rings: number[][][] }[] }[];
};
let boundaries: Boundaries | undefined;
// Offline pipeline asset, resolved relative to this module regardless of the invoking CLI's cwd.
const loadBoundaries = (): Boundaries => boundaries ??= JSON.parse(gunzipSync(readFileSync(join(__dirname, 'chainUsStates.generated.json.gz'))).toString('utf8')) as Boundaries;

export interface ChainLocation { lat: number; lng: number }
export const usStatesSchema = z.array(z.string().regex(/^[A-Z]{2}$/).refine(code => chainUsStateCodes.includes(code)))
  .min(1).max(56).refine(codes => new Set(codes).size === codes.length, 'Duplicate state');
const cache = new Map<string, string | undefined>();
// Cartographic boundaries are generalized. Abstain within 250 m of any edge.
const margin = 250 / 111_000;
function ringContains(ring: number[][], x: number, y: number): boolean | undefined {
  let inside = false;
  const scale = Math.cos(y * Math.PI / 180);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]!, [bx, by] = ring[i]!;
    const dx = (bx! - ax!) * scale, dy = by! - ay!, px = (x - ax!) * scale, py = y - ay!;
    const length = dx * dx + dy * dy, t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0;
    if (Math.hypot(px - t * dx, py - t * dy) <= margin) return undefined;
    if ((ay! > y) !== (by! > y) && x < (bx! - ax!) * (y - ay!) / (by! - ay!) + ax!) inside = !inside;
  }
  return inside;
}
/** Bounded memoization; no geocoding/model/network calls. Unknown or border locations abstain. */
export function chainUsState(location?: ChainLocation): string | undefined {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)
    || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) return undefined;
  const key = `${location.lat}:${location.lng}`;
  if (cache.has(key)) return cache.get(key);
  const found = new Set<string>();
  let uncertain = false;
  for (const state of loadBoundaries().states) for (const polygon of state.polygons) {
    const [west, south, east, north] = polygon.bounds;
    const x = location.lng + 360 * Math.round(((west! + east!) / 2 - location.lng) / 360), y = location.lat;
    const longitudeMargin = margin / Math.max(.01, Math.cos(y * Math.PI / 180));
    if (x < west! - longitudeMargin || x > east! + longitudeMargin || y < south! - margin || y > north! + margin) continue;
    const outer = ringContains(polygon.rings[0]!, x, y);
    if (outer === undefined) { uncertain = true; continue; }
    if (!outer) continue;
    let hole = false;
    for (const ring of polygon.rings.slice(1)) {
      const holeX = x + 360 * Math.round((ring[0]![0]! - x) / 360);
      const result = ringContains(ring, holeX, y);
      if (result === undefined) uncertain = true;
      if (result) hole = true;
    }
    if (!hole) found.add(state.code);
  }
  const result = !uncertain && found.size === 1 ? [...found][0] : undefined;
  if (cache.size >= 10_000) cache.clear();
  cache.set(key, result);
  return result;
}
