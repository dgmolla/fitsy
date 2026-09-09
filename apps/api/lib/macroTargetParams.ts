import { MACRO_DIMENSIONS, activeTarget, type MacroTargets } from '@fitsy/shared';

const aliases = { calories: 'calories', proteinG: 'protein', carbsG: 'carbs', fatG: 'fat' } as const;

/** Normalize serving targets from existing short names and canonical gram names. */
export function parseMacroTargetParams(params: URLSearchParams): MacroTargets {
  const targets: MacroTargets = {};
  for (const key of MACRO_DIMENSIONS) {
    const names = new Set([key, aliases[key]]);
    const raw = [...names].flatMap(name => params.getAll(name));
    if (!raw.length) continue;
    const values = raw.map(text => {
      const n = text.trim() === '' ? NaN : Number(text);
      // Number() silently turns nonzero tiny inputs into zero.
      return n === 0 && /[1-9]/.test(text.trim().split(/e/i)[0]!) ? NaN : n;
    });
    const value = values[0]!;
    if (values.some(n => !Number.isFinite(n) || n < 0 || (n > 0 && n < .01) || n > 100_000 || n !== value)) {
      throw new Error('Invalid macro target');
    }
    if (activeTarget(value)) targets[key] = value;
  }
  return targets;
}
