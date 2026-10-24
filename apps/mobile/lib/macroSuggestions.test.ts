import { SUGGESTION_FILTERS, applySuggestionFilter } from './macroSuggestions';
import { MEALS_PER_DAY } from './macroCalculator';
import { macroCalories } from './macroEnergy';

const expected = {
  'low-fat': { protein: 0.14, carbs: 0.65, fat: 0.21 },
} as const;
const hintedShare = { 'low-fat': '21% fat' } as const;

test('every generated diet style has a truthful label and balanced weights', () => {
  expect(SUGGESTION_FILTERS.map(style => style.id)).toEqual(['low-fat']);
  for (const style of SUGGESTION_FILTERS) {
    expect(style.label).toBeTruthy();
    expect(style.icon).toBeTruthy();
    expect(style.hint).toContain(hintedShare[style.id]);
    expect(Object.values(expected[style.id]).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  }
  expect(SUGGESTION_FILTERS[0].label).toBe('Low fat');
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

test('low fat keeps its defining allocation without repurposing the removed presets', () => {
  expect(applySuggestionFilter('low-fat', '3000')).toEqual({ protein: '105', carbs: '488', fat: '70' });
});

test.each(['', 'abc', 'Infinity', '-Infinity', '2500junk', '-100', '0'])('invalid suggestion calories %s use defaults', input => {
  expect(applySuggestionFilter('low-fat', input)).toEqual(applySuggestionFilter('low-fat', '2000'));
});
