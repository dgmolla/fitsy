import { shuffleResults } from './shuffle';

afterEach(() => jest.restoreAllMocks());

it.each([0, 0.5, 0.999999])('preserves every loaded result and changes the leading card (random=%s)', random => {
  jest.spyOn(Math, 'random').mockReturnValue(random);
  const rows = Object.freeze(Array.from({ length: 20 }, (_, id) => Object.freeze({ id, name: `Meal ${id}` })));
  const shuffled = shuffleResults(rows);
  expect(shuffled).not.toBe(rows);
  expect(shuffled[0]).not.toBe(rows[0]);
  expect(new Set(shuffled)).toEqual(new Set(rows));
  expect(shuffled).toHaveLength(rows.length);
  expect(rows.map(row => row.id)).toEqual(Array.from({ length: 20 }, (_, id) => id));
});

it.each([{ rows: [] }, { rows: [{ id: 'only-result' }] }])('leaves a list without alternatives intact: %j', ({ rows }) => {
  expect(shuffleResults(rows)).toEqual(rows);
});
