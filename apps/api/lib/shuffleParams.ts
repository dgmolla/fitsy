import { MACRO_DIMENSIONS, type MacroTargets } from '@fitsy/shared';
import { parseMacroTargetParams } from './macroTargetParams';

export interface ShuffleParams {
  lat: number;
  lng: number;
  radiusMiles: number;
  targets: MacroTargets;
  dietary?: string;
  cuisineType?: string;
  maxCalories?: number;
  excludeRecent: string[];
  seed?: string;
}
const aliases = { calories: 'calories', proteinG: 'protein', carbsG: 'carbs', fatG: 'fat' } as const;

/** Use search's target validation, retaining zero as an exhausted remaining budget. */
export function parseShuffleParams(params: URLSearchParams): ShuffleParams {
  const single = (key: string): string | undefined => {
    const values = params.getAll(key);
    if (values.length > 1 || values[0]?.trim() === '') throw Error(`Invalid ${key}`);
    return values[0];
  };
  const number = (key: string, fallback?: number): number => {
    const raw = single(key), value = raw === undefined ? fallback : Number(raw);
    if (value === undefined || !Number.isFinite(value)) throw Error(`Invalid ${key}`);
    return value;
  };
  const lat = number('lat'), lng = number('lng'), radiusMiles = number('radius', 3);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw Error('Invalid lat/lng');
  if (radiusMiles <= 0 || radiusMiles > 50) throw Error('radius must be between 0 and 50 miles');
  const targets = parseMacroTargetParams(params);
  for (const key of MACRO_DIMENSIONS) {
    if ((params.has(key) || params.has(aliases[key])) && targets[key] === undefined) targets[key] = 0;
  }
  if (!Object.keys(targets).length) throw Error('At least one remaining macro target is required');
  const dietary = single('dietary'), cuisineType = single('cuisineType'), seed = single('seed');
  for (const [key, value] of [['dietary', dietary], ['cuisineType', cuisineType], ['seed', seed]]) {
    if (value !== undefined && value.length > 100) throw Error(`${key} must be 100 characters or fewer`);
  }
  const maxCalories = params.has('maxCalories') ? number('maxCalories') : undefined;
  if (maxCalories !== undefined && (maxCalories < 0 || maxCalories > 100_000)) throw Error('Invalid maxCalories');
  const recent = single('excludeRecent');
  if (recent !== undefined && recent.length > 12_899) throw Error('excludeRecent is too long');
  const excludeRecent = [...new Set(recent === undefined ? [] : recent.split(','))].sort();
  if (excludeRecent.length > 100 || excludeRecent.some(id => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    throw Error('excludeRecent must contain at most 100 comma-separated item ids');
  }
  return { lat, lng, radiusMiles, targets, excludeRecent,
    ...(dietary === undefined ? {} : { dietary }), ...(cuisineType === undefined ? {} : { cuisineType }),
    ...(maxCalories === undefined ? {} : { maxCalories }), ...(seed === undefined ? {} : { seed }) };
}
