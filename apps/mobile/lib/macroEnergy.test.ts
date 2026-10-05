import { isIndependentSearchFilter, macroCalories, normalizeCompleteTarget, parseTarget, settleTargetEdit } from './macroEnergy';

const balanced = { calories: '600', protein: '40', carbs: '65', fat: '20' };
const kcal = (target: typeof balanced) => macroCalories({ protein: Number(target.protein), carbs: Number(target.carbs), fat: Number(target.fat) });

test('settled macro edits update calories and never cap manual protein', () => {
  const protein = settleTargetEdit({ ...balanced, protein: '55' }, 'protein');
  expect(protein).toEqual({ ...balanced, protein: '55', calories: '660' });
  const manual = settleTargetEdit({ ...protein, protein: '85' }, 'protein');
  expect(manual.protein).toBe('85');
  expect(Number(manual.calories)).toBe(kcal(manual));
});

test('calorie edits preserve valid energy proportions, then snap to whole grams', () => {
  const result = settleTargetEdit({ ...balanced, calories: '607' }, 'calories');
  expect(Number(result.protein) / Number(result.carbs)).toBeCloseTo(40 / 65, 1);
  expect(Number(result.calories)).toBe(kcal(result));
  expect(Object.values(result).every(value => Number.isInteger(Number(value)))).toBe(true);
});

test('a complete empty allocation uses the selected goal without a cap', () => {
  const empty = { calories: '1000', protein: '', carbs: '', fat: '' };
  const result = settleTargetEdit(empty, 'calories', 'build_muscle', true);
  expect(Number(result.protein)).toBeGreaterThan(0);
  expect(Number(result.calories)).toBe(kcal(result));
  const manual = settleTargetEdit({ ...result, protein: '80' }, 'protein', 'build_muscle', true);
  expect(manual.protein).toBe('80');
});

test('entering a complete target one field at a time keeps unfinished drafts', () => {
  const partial = { calories: '600', protein: '40', carbs: '', fat: '' };
  expect(settleTargetEdit(partial, 'protein', 'build_muscle', true)).toEqual(partial);
  const withCarbs = { ...partial, carbs: '65' };
  expect(settleTargetEdit(withCarbs, 'carbs', 'build_muscle', true)).toEqual(withCarbs);
  expect(settleTargetEdit({ ...withCarbs, fat: '20' }, 'fat', 'build_muscle', true)).toEqual(balanced);
});

test('calorie fallback retains protein entered before the remaining macros', () => {
  const first = { calories: '600', protein: '80', carbs: '', fat: '' };
  const result = settleTargetEdit(first, 'calories', 'build_muscle', true);
  expect(result.protein).toBe('80');
  expect(Number(result.carbs)).toBeGreaterThan(0);
  expect(Number(result.fat)).toBeGreaterThan(0);
  expect(Number(result.calories)).toBe(kcal(result));
  const zero = settleTargetEdit({ ...first, protein: '0' }, 'calories', 'build_muscle', true);
  expect(zero.protein).toBe('0');
  const belowProteinEnergy = { ...first, calories: '200' };
  expect(settleTargetEdit(belowProteinEnergy, 'calories', 'build_muscle', true)).toEqual(belowProteinEnergy);
});

test('partial search filters and temporary invalid drafts do not become complete targets', () => {
  const partial = { calories: '600', protein: '40', carbs: '', fat: '20' };
  expect(settleTargetEdit({ ...partial, protein: '45' }, 'protein')).toEqual({ ...partial, protein: '45' });
  expect(settleTargetEdit({ ...partial, calories: '650' }, 'calories')).toEqual({ ...partial, calories: '650' });
  expect(settleTargetEdit({ calories: '600', protein: '0', carbs: '0', fat: '0' }, 'calories'))
    .toEqual({ calories: '600', protein: '0', carbs: '0', fat: '0' });
  for (const input of ['', '.', '12junk', '-1', 'Infinity']) expect(parseTarget(input)).toBeNull();
  expect(settleTargetEdit({ ...balanced, protein: '' }, 'protein')).toEqual({ ...balanced, protein: '' });
  expect(settleTargetEdit({ ...balanced, calories: '' }, 'calories')).toEqual({ ...balanced, calories: '' });
  expect(isIndependentSearchFilter({ calories: '600', protein: '0', carbs: '65', fat: '20' })).toBe(true);
  expect(isIndependentSearchFilter(balanced)).toBe(false);
});

test('rapid ordered edits keep the latest values and restored complete targets agree with energy', () => {
  const first = settleTargetEdit({ ...balanced, protein: '45' }, 'protein');
  const second = settleTargetEdit({ ...first, fat: '25' }, 'fat');
  const third = settleTargetEdit({ ...second, calories: '700' }, 'calories');
  expect(Number(third.calories)).toBe(kcal(third));
  expect(third.protein).not.toBe(balanced.protein);
  expect(normalizeCompleteTarget({ ...third, calories: '999' })).toEqual(third);
  expect(normalizeCompleteTarget({ ...third, calories: '' })).toEqual({ ...third, calories: '' });
});
