import { createHash } from 'node:crypto';
import type { MacroTargets, ShuffleResponse } from '@fitsy/shared';

export const SHUFFLE_WEIGHT_POWER = 4;
export const SHUFFLE_CACHE_MS = 10_000;

export interface ShufflePick {
  id: string; name: string; restaurantId: string;
  calories: number; proteinG: number; carbsG: number; fatG: number; scoreSum: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null; source: string | null;
}

export function shuffleStages(radiusMiles: number) {
  const stages = [
    { radiusMiles, tolerance: .1, fallback: 'none' as const },
    { radiusMiles, tolerance: .25, fallback: 'tolerance' as const },
  ];
  const wider = Math.min(50, radiusMiles * 2);
  return wider > radiusMiles ? [...stages, { radiusMiles: wider, tolerance: .25, fallback: 'radius' as const }] : stages;
}

export function shuffleMeta(entitled: boolean, stage: ReturnType<typeof shuffleStages>[number], empty = false): ShuffleResponse['meta'] {
  return { locked: !entitled, radiusMiles: stage.radiusMiles, fallback: entitled ? stage.fallback : null,
    tolerance: entitled ? stage.tolerance : null, emptyReason: empty ? 'no_matches' : null };
}

export function emptyShuffleResponse(entitled: boolean, stage: ReturnType<typeof shuffleStages>[number]): ShuffleResponse {
  return { data: null, meta: shuffleMeta(entitled, stage, true) };
}

/** Project only the public teaser for locked callers, even if the selected row contains nutrition. */
export function shufflePaidDetails(pick: ShufflePick, entitled: boolean): Pick<NonNullable<ShuffleResponse['data']>, 'item' | 'macros' | 'fitScore'> {
  if (!entitled) return { item: null, macros: null, fitScore: null };
  return { item: { id: pick.id, name: pick.name },
    macros: { calories: pick.calories, proteinG: pick.proteinG, carbsG: pick.carbsG, fatG: pick.fatG,
      confidence: pick.confidence ?? 'LOW', nutritionBasis: ['merchant', 'official'].includes(pick.source ?? '') ? 'published' : 'estimated' },
    fitScore: 1 / (1 + pick.scoreSum) };
}

/** Zero never widens; maxCalories is a hard cap even during fallback. */
export function shuffleMacroCaps(targets: MacroTargets, tolerance: number, maxCalories?: number): MacroTargets {
  const caps: MacroTargets = Object.fromEntries(Object.entries(targets).map(([key, value]) => [key, value * (1 + tolerance)]));
  if (maxCalories !== undefined) caps.calories = Math.min(caps.calories ?? Infinity, maxCalories);
  return caps;
}

/** Deterministic exponential race; smaller priority wins, better fits win more often.
 * The database uses this same 48-bit MD5 uniform and formula without transferring the candidate pool.
 */
export function shufflePriority(seed: string, itemId: string, scoreSum: number): number {
  const hex = createHash('md5').update(`${seed}:${itemId}`).digest('hex').slice(0, 12);
  const uniform = (parseInt(hex, 16) + 1) / (2 ** 48 + 1);
  return -Math.log(uniform) * (1 + scoreSum) ** SHUFFLE_WEIGHT_POWER;
}

/** Bounded instance-local cache. Entitlement must be read before each lookup. */
export class ShuffleCache<T> {
  private readonly entries = new Map<string, { until: number; value: T }>();
  constructor(private readonly maxEntries = 256) {}
  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (entry && now < entry.until) return entry.value;
    this.entries.delete(key);
    return undefined;
  }
  set(key: string, value: T, now = Date.now()): void {
    for (const [key, entry] of this.entries) if (entry.until <= now) this.entries.delete(key);
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    // Recheck business hours at least every minute, including requests just before closing.
    const until = Math.min(now + SHUFFLE_CACHE_MS, (Math.floor(now / 60_000) + 1) * 60_000);
    this.entries.set(key, { until, value });
  }
}
