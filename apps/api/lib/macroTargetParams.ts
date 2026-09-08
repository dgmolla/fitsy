import { MACRO_DIMENSIONS, type MacroTargets } from '@fitsy/shared';

const aliases = { calories: 'calories', proteinG: 'protein', carbsG: 'carbs', fatG: 'fat' } as const;

/** Normalize serving targets from existing short names and canonical gram names. */
export function parseMacroTargetParams(params: URLSearchParams): MacroTargets {
  const targets: MacroTargets = {};
  for (const key of MACRO_DIMENSIONS) {
    const names = new Set([key, aliases[key]]);
    const raw = [...names].flatMap(name => params.getAll(name));
    if (!raw.length) continue;
    const values = raw.map(value => value.trim() === '' ? NaN : Number(value));
    const value = values[0]!;
    if (values.some(n => !Number.isFinite(n) || n < 0 || n > 100_000 || n !== value)) {
      throw new Error('Invalid macro target');
    }
    if (value > 0) targets[key] = value;
  }
  return targets;
}
