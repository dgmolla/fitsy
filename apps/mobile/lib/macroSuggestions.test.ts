import { SUGGESTION_FILTERS, applySuggestionFilter } from './macroSuggestions';
import { MEALS_PER_DAY } from './macroCalculator';
import { macroCalories } from './macroEnergy';

const expected = {
  'protein-dense': { protein: 0.16, carbs: 0.54, fat: 0.30 },
  'low-carb': { protein: 0.15, carbs: 0.50, fat: 0.35 },
  'low-fat': { protein: 0.14, carbs: 0.65, fat: 0.21 },
} as const;
const hintedShare = { 'protein-dense': '16% protein', 'low-carb': '50% carb', 'low-fat': '21% fat' } as const;

test('every generated diet style has a truthful label and balanced weights', () => {
  expect(SUGGESTION_FILTERS.map(style => style.id)).toEqual(['protein-dense', 'low-carb', 'low-fat']);
  for (const style of SUGGESTION_FILTERS) {
    expect(style.label).toBeTruthy();
    expect(style.icon).toBeTruthy();
    expect(style.hint).toContain(hintedShare[style.id]);
    expect(Object.values(expected[style.id]).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  }
  expect(SUGGESTION_FILTERS.find(style => style.id === 'low-carb')?.label).toBe('Carb mindful');
});

test.each(SUGGESTION_FILTERS.map(style => style.id))('%s stays within 40 g protein per meal across the supported range', id => {
  for (let calories = 1200; calories <= 3500; calories++) {
    const split = applySuggestionFilter(id, String(calories));
    const grams = { protein: Number(split.protein), carbs: Number(split.carbs), fat: Number(split.fat) };
    expect(Math.round(grams.protein / MEALS_PER_DAY)).toBeLessThanOrEqual(40);
    expect(Math.abs(macroCalories(grams) - calories)).toBeLessThanOrEqual(9);
  }
  const beyondRange = applySuggestionFilter(id, '5000');
  expect(Math.round(Number(beyondRange.protein) / MEALS_PER_DAY)).toBeGreaterThan(40);
});

test('the styles preserve their distinct allocation order', () => {
  const high = applySuggestionFilter('protein-dense', '3000');
  const lowCarb = applySuggestionFilter('low-carb', '3000');
  const lowFat = applySuggestionFilter('low-fat', '3000');
  expect(Number(high.protein)).toBeGreaterThan(Number(lowCarb.protein));
  expect(Number(lowCarb.carbs)).toBeLessThan(Number(lowFat.carbs));
  expect(Number(lowFat.fat)).toBeLessThan(Number(lowCarb.fat));
});

test.each(['', 'abc', 'Infinity', '-Infinity', '2500junk', '-100', '0'])('invalid suggestion calories %s use defaults', input => {
  expect(applySuggestionFilter('protein-dense', input)).toEqual(applySuggestionFilter('protein-dense', '2000'));
});
