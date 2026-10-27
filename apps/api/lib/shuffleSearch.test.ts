import { parseSearchShuffle } from './shuffleSearch';
import { restaurantCursorContext } from './restaurantCursorContext';
import { decodeCursor, encodeCursor } from './restaurantService';

const parse = (query: string, cursorSeed?: string) => parseSearchShuffle(new URLSearchParams(query), cursorSeed);

test('normal search stays normal, shuffle gets a unique seed, and paging reuses it', () => {
  expect(parse('')).toBeUndefined();
  expect(parse('shuffle=0')).toBeUndefined();
  const first = parse('shuffle=1')!;
  expect(first.seed).toBeTruthy();
  expect(first.seed).not.toBe(parse('shuffle=1')!.seed);
  expect(parse('shuffle=1', first.seed)).toEqual(first);
  expect(parse('shuffle=1&seed=explicit', first.seed)!.seed).toBe('explicit');
});

test('normalizes shown restaurant identities for reproducible cursor context', () => {
  const shuffle = parse('shuffle=1&seed=demo&excludeRestaurantIds=b,a,a')!;
  expect(shuffle.excludeRestaurantIds).toEqual(['a', 'b']);
  const context = { lat: 21, lng: -41, radiusMiles: 3, targets: { calories: 600 }, shuffle };
  const hash = restaurantCursorContext(context);
  expect(hash).toHaveLength(64);
  expect(restaurantCursorContext({ ...context, shuffle: parse('shuffle=1&seed=demo&excludeRestaurantIds=a,b')! })).toBe(hash);
  for (const changed of [{ ...shuffle, seed: 'another' }, { ...shuffle, excludeRestaurantIds: ['a'] }]) {
    expect(restaurantCursorContext({ ...context, shuffle: changed })).not.toBe(hash);
  }
  expect(restaurantCursorContext({ ...context, targets: {} })).not.toBe(hash);
});

test('bounds encoded UUID exclusions rather than accepting a request too long for deployment', () => {
  const ids = Array.from({ length: 206 }, (_, i) => `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`);
  expect(parse(`shuffle=1&excludeRestaurantIds=${ids.slice(0, 205).join(',')}`)!.excludeRestaurantIds).toEqual(ids.slice(0, 205));
  expect(() => parse(`shuffle=1&excludeRestaurantIds=${ids.join(',')}`)).toThrow('8000 encoded characters');
});

test.each(['shuffle=true', 'shuffle=', 'shuffle=1&shuffle=1', 'shuffle=1&seed=', 'shuffle=1&seed=a&seed=b',
  'seed=unused', 'excludeRestaurantIds=unused', 'shuffle=1&excludeRestaurantIds=a,,b',
  'shuffle=1&excludeRestaurantIds=a&excludeRestaurantIds=b', 'shuffle=1&excludeRestaurantIds=a%27OR%201=1',
  `shuffle=1&seed=${'x'.repeat(101)}`, `shuffle=1&excludeRestaurantIds=${'x'.repeat(129)}`,
  `shuffle=1&excludeRestaurantIds=${Array.from({ length: 1001 }, (_, i) => i).join(',')}`,
])('rejects malformed or unbounded shuffle input: %s', query => {
  expect(() => parse(query)).toThrow();
});

test('cursor seed roundtrips and rejects malformed values before database access', () => {
  const cursor = { id: 'restaurant', orderKey: .5, shuffleSeed: 'seed' };
  expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  for (const shuffleSeed of ['', 1, 'x'.repeat(101)]) {
    expect(decodeCursor(Buffer.from(JSON.stringify({ ...cursor, shuffleSeed })).toString('base64'))).toBeNull();
  }
});
