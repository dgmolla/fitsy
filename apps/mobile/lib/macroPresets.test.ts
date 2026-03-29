/**
 * Unit tests for macro preset constants and query-param building logic.
 */
import { PRESETS, type MacroValues } from './macroPresets';

// Query-string builder (mirrors logic in search.tsx doFetch)
function buildMacroParams(inputs: MacroValues): Record<string, number> {
  const params: Record<string, number> = {};
  const protein = parseFloat(inputs.protein);
  const carbs = parseFloat(inputs.carbs);
  const fat = parseFloat(inputs.fat);
  const calories = parseFloat(inputs.calories);
  if (!isNaN(protein)) params.protein = protein;
  if (!isNaN(carbs)) params.carbs = carbs;
  if (!isNaN(fat)) params.fat = fat;
  if (!isNaN(calories)) params.calories = calories;
  return params;
}

describe('PRESETS', () => {
  it('exports exactly three presets', () => {
    expect(PRESETS).toHaveLength(3);
  });

  it('Cut preset has correct macro values', () => {
    const cut = PRESETS.find((p) => p.label === 'Cut (2000 kcal/day)');
    expect(cut).toBeDefined();
    expect(cut!.values).toEqual({ calories: '2000', protein: '150', carbs: '200', fat: '67' });
  });

  it('Bulk preset has correct macro values', () => {
    const bulk = PRESETS.find((p) => p.label === 'Bulk (3000 kcal/day)');
    expect(bulk).toBeDefined();
    expect(bulk!.values).toEqual({ calories: '3000', protein: '180', carbs: '350', fat: '100' });
  });

  it('Maintain preset has correct macro values', () => {
    const maintain = PRESETS.find((p) => p.label === 'Maintain (2500 kcal/day)');
    expect(maintain).toBeDefined();
    expect(maintain!.values).toEqual({ calories: '2500', protein: '160', carbs: '280', fat: '83' });
  });

  it('all preset calorie values match their labels', () => {
    for (const preset of PRESETS) {
      const labelKcal = preset.label.match(/(\d+) kcal/)?.[1];
      expect(labelKcal).toBeDefined();
      expect(preset.values.calories).toBe(labelKcal);
    }
  });
});

describe('buildMacroParams', () => {
  it('returns empty object for all-empty inputs', () => {
    expect(buildMacroParams({ protein: '', carbs: '', fat: '', calories: '' })).toEqual({});
  });

  it('includes only numeric fields and omits empty ones', () => {
    const result = buildMacroParams({ protein: '150', carbs: '', fat: '67', calories: '2000' });
    expect(result).toEqual({ protein: 150, fat: 67, calories: 2000 });
    expect(result).not.toHaveProperty('carbs');
  });

  it('parses string values to numbers', () => {
    const result = buildMacroParams({ protein: '160', carbs: '280', fat: '83', calories: '2500' });
    expect(result).toEqual({ protein: 160, carbs: 280, fat: 83, calories: 2500 });
  });

  it('ignores non-numeric strings', () => {
    const result = buildMacroParams({ protein: 'abc', carbs: '100', fat: '', calories: '' });
    expect(result).not.toHaveProperty('protein');
    expect(result).toEqual({ carbs: 100 });
  });

  it('Cut preset produces correct numeric params', () => {
    const cut = PRESETS.find((p) => p.label === 'Cut (2000 kcal/day)')!;
    expect(buildMacroParams(cut.values)).toEqual({ protein: 150, carbs: 200, fat: 67, calories: 2000 });
  });
});
