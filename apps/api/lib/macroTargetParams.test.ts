import { parseMacroTargetParams } from './macroTargetParams';
import { computeMatchScore, hasTargets } from '@fitsy/shared';
import { macroScoreSumSql } from './macroScoreSql';

const parse = (query: string) => parseMacroTargetParams(new URLSearchParams(query));

test('short and gram target names describe the same meal', () => {
  const expected = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };
  expect(parse('calories=600&protein=40&carbs=60&fat=20')).toEqual(expected);
  expect(parse('calories=600&proteinG=40&carbsG=60&fatG=20')).toEqual(expected);
  expect(parse('protein=40&proteinG=40&protein=40')).toEqual({ proteinG: 40 });
  expect(parse('calories=100000')).toEqual({ calories: 100000 });
});

test.each(['protein=NaN', 'proteinG=-1', 'fat=Infinity', 'calories=100001',
  'carbs=', 'calories=+', 'protein=40&proteinG=50', 'fat=10&fat=20'])('%s is rejected', query => {
  expect(() => parse(query)).toThrow('Invalid macro target');
});

test('zero means inactive; invalid internal targets never produce an active score', () => {
  expect(parse('calories=0&protein=40')).toEqual({ proteinG: 40 });
  expect(hasTargets({ calories: 0, proteinG: NaN, fatG: Infinity })).toBe(false);
  expect(computeMatchScore({}, { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 })).toBeNull();
  expect(computeMatchScore({ calories: 600 }, { calories: NaN, proteinG: 40, carbsG: 60, fatG: 20 })).toBeNull();
  expect(computeMatchScore({ calories: 600 }, { calories: -1, proteinG: 40, carbsG: 60, fatG: 20 })).toBeNull();
});

test('SQL scoring supports a developer alias and rejects executable alias text', () => {
  expect(macroScoreSumSql({ proteinG: 40 }, 'dish').text).toContain('dish."proteinG"');
  expect(macroScoreSumSql({ proteinG: 40 }, 'dish').values).toEqual([40, 40]);
  expect(() => macroScoreSumSql({ proteinG: 40 }, 'm; DROP')).toThrow('Invalid SQL alias');
});
