import { computeMatchScore, shuffleResponseSchema } from '@fitsy/shared';
import { parseShuffleParams } from './shuffleParams';
import { ShuffleCache, emptyShuffleResponse, shuffleMacroCaps, shuffleMeta, shufflePaidDetails, shufflePriority, shuffleStages, type ShufflePick } from './shuffleSelection';
import { restaurantAvailability } from './restaurantHours';

const parse = (query = '') => parseShuffleParams(new URLSearchParams(`lat=34&lng=-118&calories=600&${query}`));

describe('Shuffle input and remaining budgets', () => {
  test('normalizes search aliases, defaults, exclusions and deterministic string seeds', () => {
    expect(parse('protein=40&proteinG=40&carbs=60&fat=20&excludeRecent=b,a,b&seed=0')).toEqual({
      lat: 34, lng: -118, radiusMiles: 3, targets: { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 },
      excludeRecent: ['a', 'b'], seed: '0',
    });
  });
  test('zero remaining is an exhausted budget, rather than a disabled dimension', () => {
    const params = parseShuffleParams(new URLSearchParams('lat=0&lng=0&calories=0&fat=0'));
    expect(params.targets).toEqual({ calories: 0, fatG: 0 });
    expect(shuffleMacroCaps(params.targets, .25)).toEqual({ calories: 0, fatG: 0 });
  });
  test.each(['lat=0&lng=0', 'lat=&lng=0&calories=2', 'lat=91&lng=0&calories=2',
    'lat=0&lng=-181&calories=2', 'lat=0&lat=1&lng=0&calories=2'])('rejects incomplete or ambiguous locations/targets: %s', query => {
    expect(() => parseShuffleParams(new URLSearchParams(query))).toThrow();
  });
  test.each(['radius=0', 'radius=51', 'radius=NaN', 'radius=', 'radius=2&radius=2',
    'protein=-1', 'protein=NaN', 'protein=Infinity', 'protein=1e-300', 'protein=1e-400',
    'protein=40&proteinG=41', 'maxCalories=-1', 'maxCalories=Infinity', 'maxCalories=',
    'seed=', 'seed=x&seed=y', 'dietary=', 'cuisineType=', 'excludeRecent=', 'excludeRecent=a,,b',
    'excludeRecent=' + 'x'.repeat(129), 'excludeRecent=' + Array.from({ length: 101 }, (_, i) => `id-${i}`).join(','),
    'seed=' + 'x'.repeat(101)])('rejects invalid bounded input: %s', query => {
    expect(() => parse(query)).toThrow();
  });
  test('fallback widens only soft macro caps, preserving calorie caps and exhausted dimensions', () => {
    expect(shuffleMacroCaps({ calories: 600, proteinG: 40, fatG: 0 }, .25, 610)).toEqual({ calories: 610, proteinG: 50, fatG: 0 });
    expect(shuffleMacroCaps({ proteinG: 40 }, .1, 0)).toEqual({ calories: 0, proteinG: 44 });
  });
});

describe('fit-weighted seeded choice and fallback', () => {
  test('identical seeds produce the same winner regardless of candidate enumeration order', () => {
    const candidates = [{ id: 'a', score: .2 }, { id: 'b', score: .5 }, { id: 'c', score: 0 }];
    const pick = (items: typeof candidates) => [...items].sort((a, b) => shufflePriority('repeat', a.id, a.score) - shufflePriority('repeat', b.id, b.score))[0]!.id;
    expect(pick(candidates)).toBe(pick(candidates.reverse()));
    expect(shufflePriority('repeat', 'a', .2)).not.toBe(shufflePriority('different', 'a', .2));
  });
  test('better actual macro fits win more often while poorer fits retain a chance', () => {
    const targets = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };
    const worse = { calories: 200, proteinG: 10, carbsG: 20, fatG: 5 };
    const score = computeMatchScore(targets, worse)! ** 2;
    let goodWins = 0;
    for (let i = 0; i < 2000; i++) goodWins += Number(shufflePriority(String(i), 'good', 0) < shufflePriority(String(i), 'worse', score));
    expect(goodWins).toBeGreaterThan(1900);
    expect(goodWins).toBeLessThan(2000);
  });
  test('ties have equal probability and all priorities are finite and positive', () => {
    let wins = 0;
    for (let i = 0; i < 1000; i++) {
      const a = shufflePriority(String(i), 'a', 0), b = shufflePriority(String(i), 'b', 0);
      expect(a).toBeGreaterThan(0);
      expect(Number.isFinite(a)).toBe(true);
      wins += Number(a < b);
    }
    expect(wins).toBeGreaterThan(440);
    expect(wins).toBeLessThan(560);
  });
  test('tries original tolerance, wider tolerance, then wider radius with a 50 mile ceiling', () => {
    expect(shuffleStages(3)).toEqual([
      { radiusMiles: 3, tolerance: .1, fallback: 'none' },
      { radiusMiles: 3, tolerance: .25, fallback: 'tolerance' },
      { radiusMiles: 6, tolerance: .25, fallback: 'radius' },
    ]);
    expect(shuffleStages(40).at(-1)!.radiusMiles).toBe(50);
    expect(shuffleStages(50)).toHaveLength(2);
  });
});

describe('restaurant-local opening hours', () => {
  const hours = { timeZone: 'America/Los_Angeles', periods: [{ day: 1, opens: 600, closes: 1200 }] };
  test('uses the restaurant timezone and exclusive closing boundary, including DST', () => {
    expect(restaurantAvailability(hours, new Date('2026-10-26T17:00:00Z'))).toBe('open');
    expect(restaurantAvailability(hours, new Date('2026-10-27T03:00:00Z'))).toBe('closed');
    expect(restaurantAvailability(hours, new Date('2026-11-02T18:00:00Z'))).toBe('open');
    expect(restaurantAvailability(hours, new Date('2026-11-02T17:59:59Z'))).toBe('closed');
  });
  test('overnight periods wrap across the week and closed days stay closed', () => {
    const overnight = { timeZone: 'UTC', periods: [{ day: 6, opens: 1320, closes: 120 }] };
    expect(restaurantAvailability(overnight, new Date('2026-10-25T01:59:00Z'))).toBe('open');
    expect(restaurantAvailability(overnight, new Date('2026-10-25T02:00:00Z'))).toBe('closed');
    expect(restaurantAvailability(overnight, new Date('2026-10-26T01:00:00Z'))).toBe('closed');
  });
  test('missing hours are unknown and malformed/empty hours fail closed', () => {
    expect(restaurantAvailability(null, new Date())).toBe('unknown');
    for (const invalid of [{}, { timeZone: 'not-a-timezone', periods: [] }, { timeZone: 'UTC', periods: [] },
      { timeZone: 'UTC', periods: [{ day: 1, opens: 900, closes: 900 }] }]) {
      expect(restaurantAvailability(invalid, new Date())).toBe('closed');
    }
  });
});

describe('bounded short cache', () => {
  test('expires responses and keeps user/entitlement/filter contexts separate', () => {
    const cache = new ShuffleCache<string>(2);
    cache.set('subscriber-a', 'paid', 1_000);
    expect(cache.get('subscriber-b', 1_001)).toBeUndefined();
    expect(cache.get('locked-a', 1_001)).toBeUndefined();
    expect(cache.get('subscriber-a', 10_999)).toBe('paid');
    expect(cache.get('subscriber-a', 11_000)).toBeUndefined();
  });
  test('bounds storage and expires at the next minute so closing hours are rechecked', () => {
    const cache = new ShuffleCache<string>(2);
    cache.set('a', 'first', 55_000);
    cache.set('b', 'second', 55_000);
    cache.set('c', 'third', 55_000);
    expect(cache.get('a', 55_001)).toBeUndefined();
    expect(cache.get('b', 59_999)).toBe('second');
    expect(cache.get('c', 60_000)).toBeUndefined();
  });
});

describe('subscription projection and empty contract', () => {
  const pick: ShufflePick = { id: 'dish', name: 'Bowl', restaurantId: 'restaurant', calories: 600,
    proteinG: 40, carbsG: 60, fatG: 20, scoreSum: .5, confidence: 'HIGH', source: 'merchant' };
  test('locked callers receive no item, macro values, fit score or matching-stage metadata', () => {
    expect(shufflePaidDetails(pick, false)).toEqual({ item: null, macros: null, fitScore: null });
    expect(shuffleMeta(false, shuffleStages(3)[1]!)).toEqual({ locked: true, radiusMiles: 3,
      fallback: null, tolerance: null, emptyReason: null });
  });
  test('paid responses carry confidence and distinguish published nutrition from estimates', () => {
    expect(shufflePaidDetails(pick, true)).toMatchObject({ item: { id: 'dish', name: 'Bowl' },
      fitScore: 1 / 1.5, macros: { confidence: 'HIGH', nutritionBasis: 'published' } });
    expect(shufflePaidDetails({ ...pick, source: null, confidence: null }, true).macros)
      .toMatchObject({ confidence: 'LOW', nutritionBasis: 'estimated' });
  });
  test.each([true, false])('an explicit empty result remains contract-valid with entitlement %s', entitled => {
    const response = emptyShuffleResponse(entitled, shuffleStages(3).at(-1)!);
    expect(shuffleResponseSchema.parse(response)).toEqual(response);
    expect(response.data).toBeNull();
    expect(response.meta.emptyReason).toBe('no_matches');
  });
});
