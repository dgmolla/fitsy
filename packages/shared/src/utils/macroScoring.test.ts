import { computeMatchScore, hasTargets, type MacroNumbers, type MacroTargets } from './macroScoring';

const dimensions = ['calories', 'proteinG', 'carbsG', 'fatG'] as const;
const meal: MacroNumbers = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };

function score(targets: MacroTargets, macros: MacroNumbers): number {
  const result = computeMatchScore(targets, macros);
  if (result === null) throw new Error('Expected a rankable meal');
  return result;
}

test.each(dimensions)('%s alone ranks a closer dish ahead of both under- and overshoots', key => {
  const target = meal[key];
  const targets = { [key]: target };
  expect(hasTargets(targets)).toBe(true);
  expect(score(targets, meal)).toBe(0);
  const close = score(targets, { ...meal, [key]: target * 1.1 });
  expect(close).toBeGreaterThan(0);
  expect(close).toBeLessThan(score(targets, { ...meal, [key]: target * 1.5 }));
  expect(close).toBeLessThan(score(targets, { ...meal, [key]: target * 0.5 }));
});

test('combined relative deviations distinguish a balanced fit from a calorie-only fit', () => {
  const targets = { calories: 600, proteinG: 40 };
  // A 30% calorie deviation and 40% protein deviation form a 3-4-5 triangle.
  expect(score(targets, { ...meal, calories: 780, proteinG: 56 })).toBeCloseTo(0.5);
  const balanced = score(targets, { ...meal, calories: 660, proteinG: 44 });
  const calorieOnly = score(targets, { ...meal, proteinG: 20 });
  expect(balanced).toBeLessThan(calorieOnly);
});

test('relative fit survives a change of serving size and ignores unspecified dimensions', () => {
  const targets = { calories: 600, proteinG: 40 };
  const candidate = { ...meal, calories: 660, proteinG: 44 };
  expect(score(targets, candidate)).toBeCloseTo(score(
    { calories: 1200, proteinG: 80 }, { calories: 1320, proteinG: 88, carbsG: 120, fatG: 40 },
  ));
  expect(score(targets, { ...candidate, carbsG: NaN, fatG: -1 })).toBe(score(targets, candidate));
  expect(score({ calories: 600 }, { ...meal, calories: 0 })).toBe(1);
});

test('missing targets do not manufacture a perfect match', () => {
  expect(hasTargets({})).toBe(false);
  expect(computeMatchScore({}, meal)).toBeNull();
});

test.each(dimensions)('%s rejects unusable targets and measurements without hiding another valid target', key => {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    expect(hasTargets({ [key]: invalid })).toBe(false);
    expect(computeMatchScore({ [key]: invalid }, meal)).toBeNull();
  }
  for (const invalid of [-1, NaN, Infinity, -Infinity]) {
    expect(computeMatchScore(meal, { ...meal, [key]: invalid })).toBeNull();
    expect(score({ [key]: meal[key] }, { ...meal, [key]: 0 })).toBe(1);
  }
  const other = key === 'calories' ? 'proteinG' : 'calories';
  expect(hasTargets({ [key]: NaN, [other]: meal[other] })).toBe(true);
  expect(score({ [key]: NaN, [other]: meal[other] }, meal)).toBe(0);
});
