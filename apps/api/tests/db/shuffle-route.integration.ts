import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { shuffleResponseSchema, type ShuffleResponse } from '@fitsy/shared';
import { GET } from '../../app/api/restaurants/shuffle/route';
import { prisma } from '../../lib/restaurantService';
import { findShuffle } from '../../lib/shuffleService';
import { parseShuffleParams } from '../../lib/shuffleParams';
import { shufflePriority } from '../../lib/shuffleSelection';
import { userId, token, freeToken } from './authenticated-route.fixture';

const tag = randomUUID();
const ids = ['exact', 'tolerance', 'radius', 'closed', 'unknown', 'diet'].map(name => `${tag}-${name}`);
const targets = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };
const fullHours = { timeZone: 'UTC', periods: Array.from({ length: 7 }, (_, day) => ({ day, opens: 0, closes: 1440 })) };
const params = (query = '') => parseShuffleParams(new URLSearchParams(
  `lat=21&lng=-41&calories=600&protein=40&carbs=60&fat=20&cuisineType=${tag}-exact&${query}`,
));
const optionsFor = (name: string, query = '') => ({ ...params(query), cuisineType: `${tag}-${name}` });
const request = (query = '', auth: boolean | 'free' = true, ip = '192.0.2.145') => new NextRequest(
  `http://localhost/api/restaurants/shuffle?lat=21&lng=-41&calories=600&protein=40&carbs=60&fat=20&${query}`,
  { headers: { ...(auth ? { authorization: `Bearer ${auth === 'free' ? freeToken : token}` } : {}), 'x-forwarded-for': ip } },
);
const body = async (response: Response): Promise<ShuffleResponse> => {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return shuffleResponseSchema.parse(await response.json());
};

before(async () => {
  for (const [index, name] of ['exact', 'tolerance', 'radius', 'closed', 'unknown', 'diet'].entries()) {
    const restaurantId = ids[index]!;
    const macros = name === 'tolerance' ? { calories: 720, proteinG: 48, carbsG: 72, fatG: 24 } : targets;
    await prisma.restaurant.create({ data: {
      id: restaurantId, storeUuid: restaurantId, name: `Shuffle ${name}`, address: 'Isolated fixture', source: 'test',
      lat: name === 'radius' ? 21 + 4.5 / 69 : 21, lng: -41, cuisineTags: [`${tag}-${name}`],
      dietaryOptions: ['has_vegan'],
      ...(name === 'unknown' ? {} : { openingHours: name === 'closed' ? { timeZone: 'UTC', periods: [] } : fullHours }),
      menuItems: { create: [{ id: `${restaurantId}-a`, name: 'First bowl', ...macros,
        dietaryTags: name === 'diet' ? [] : ['vegan'], macroEstimates: { create: { ...macros, source: 'merchant', confidence: 'HIGH' } } },
      ...(name === 'exact' ? [
        { id: `${restaurantId}-b`, name: 'Second bowl', ...macros, dietaryTags: ['vegan'] },
        { id: `${restaurantId}-retired`, name: 'Retired bowl', ...macros, retiredAt: new Date(), dietaryTags: ['vegan'] },
        { id: `${restaurantId}-incomplete`, name: 'Missing protein', calories: 600, carbsG: 60, fatG: 20, dietaryTags: ['vegan'] },
        { id: `${restaurantId}-over`, name: 'Over budget', calories: 1000, proteinG: 80, carbsG: 100, fatG: 80, dietaryTags: ['vegan'] },
      ] : [])] },
    } });
  }
});
after(async () => {
  await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('subscriber gets a complete dish contract with confidence and distance', async () => {
  const result = await body(await GET(request(`cuisineType=${tag}-exact&seed=contract&dietary=vegan`)));
  assert.equal(result.meta.locked, false);
  assert.equal(result.meta.fallback, 'none');
  assert.equal(result.data!.restaurant.id, ids[0]);
  assert.equal(result.data!.availability, 'open');
  assert.equal(result.data!.distanceMiles, 0);
  assert.deepEqual({ ...result.data!.macros, confidence: undefined, nutritionBasis: undefined }, {
    ...targets, confidence: undefined, nutritionBasis: undefined,
  });
  assert.equal(result.data!.fitScore, 1);
  assert.ok(!('bestMatch' in result.data!.restaurant));
});

test('an entitled Test Store account recovers missing, stale and previously denied proof without mobile sync', async () => {
  const realFetch = global.fetch;
  process.env['REVENUECAT_PUBLIC_API_KEY'] = 'test_fixture';
  let lookups = 0;
  global.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.revenuecat.com/')) {
      assert.equal(String(input), `https://api.revenuecat.com/v1/subscribers/${userId}`);
      assert.equal(new Headers(init?.headers).get('x-is-sandbox'), 'true');
      lookups++;
      return new Response(JSON.stringify({ request_date_ms: Date.now(), subscriber: {
        original_app_user_id: '$RCAnonymousID:before-login',
        entitlements: { pro: { product_identifier: 'monthly', expires_date: new Date(Date.now() + 86_400_000).toISOString() } },
        subscriptions: { monthly: { store: 'test_store', is_sandbox: true } },
      } }));
    }
    return realFetch(input, init);
  };
  try {
    for (const scenario of ['stale', 'renewal', 'denied', 'missing']) {
      if (scenario === 'missing') await prisma.subscription.delete({ where: { userId } });
      else await prisma.subscription.update({ where: { userId }, data: {
        status: scenario === 'denied' ? 'never_subscribed' : 'active',
        expiresAt: scenario === 'renewal' ? new Date(Date.now() - 1000) : null,
        lastEventAt: new Date(Date.now() - (scenario === 'stale' ? 25 * 60 * 60 * 1000 : 2000)),
      } });
      const result = await body(await GET(request(`cuisineType=${tag}-exact&seed=subscription-${scenario}`)));
      assert.equal(result.meta.locked, false, scenario);
      assert.ok(result.data!.item?.id);
      assert.equal(result.data!.macros!.proteinG, targets.proteinG);
      assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { userId } })).status, 'active');
    }
    assert.equal(lookups, 4);
  } finally {
    global.fetch = realFetch;
    delete process.env['REVENUECAT_PUBLIC_API_KEY'];
    await prisma.subscription.upsert({ where: { userId },
      create: { userId, plan: 'monthly', status: 'active', lastEventAt: new Date() },
      update: { status: 'active', expiresAt: null, lastEventAt: new Date() },
    });
  }
});

test('SQL seeded weighting agrees with the unit-tested race and can choose multiple items per restaurant', async () => {
  const candidates = [`${ids[0]}-a`, `${ids[0]}-b`];
  const expectedWinner = (seed: string) => [...candidates].sort((a, b) => shufflePriority(seed, a, 0) - shufflePriority(seed, b, 0))[0];
  // Select a seed for each item instead of relying on random fixture ids to happen to cover both.
  const seeds = candidates.map(id => {
    const seed = Array.from({ length: 256 }, (_, i) => String(i)).find(seed => expectedWinner(seed) === id);
    assert.ok(seed, 'the deterministic race must allow each equal-weight candidate to win');
    return seed;
  });
  const winners = new Set<string>();
  for (const seed of seeds) {
    const result = await findShuffle(params(`seed=${seed}`), true);
    const expected = expectedWinner(seed);
    assert.equal(result.data!.item!.id, expected);
    winners.add(result.data!.item!.id);
  }
  assert.equal(winners.size, 2);
});

test('exclusions keep stable dish ids and never re-admit retired, incomplete or over-budget items', async () => {
  const first = `${ids[0]}-a`, second = `${ids[0]}-b`;
  const pick = await findShuffle(params(`excludeRecent=${first}`), true);
  assert.equal(pick.data!.item!.id, second);
  assert.equal(pick.data!.macros!.confidence, 'LOW', 'missing provenance is not presented as high confidence');
  const empty = await findShuffle(params(`excludeRecent=${first},${second}`), true);
  assert.equal(empty.data, null);
  assert.equal(empty.meta.emptyReason, 'no_matches');
});

test('diet is checked on the selected dish and cuisine never disappears during fallback', async () => {
  assert.equal((await findShuffle(optionsFor('diet', 'dietary=vegan'), true)).data, null);
  assert.equal((await findShuffle({ ...params(), cuisineType: 'absent-' + tag }, true)).data, null);
});

test('tolerance widens before radius and a hard calorie maximum never widens', async () => {
  const result = await findShuffle(optionsFor('tolerance'), true);
  assert.equal(result.meta.fallback, 'tolerance');
  assert.equal(result.meta.radiusMiles, 3);
  assert.equal(result.meta.tolerance, .25);
  assert.equal((await findShuffle(optionsFor('tolerance', 'maxCalories=700'), true)).data, null);
  assert.equal((await findShuffle(params('maxCalories=0'), true)).data, null);
});

test('radius widens only after both local attempts fail', async () => {
  const result = await findShuffle(optionsFor('radius'), true);
  assert.equal(result.meta.fallback, 'radius');
  assert.equal(result.meta.radiusMiles, 6);
  assert.ok(result.data!.distanceMiles > 3 && result.data!.distanceMiles < 6);
});

test('known closed restaurants are excluded and missing hours are labeled unknown', async () => {
  assert.equal((await findShuffle(optionsFor('closed'), true)).data, null);
  assert.equal((await findShuffle(optionsFor('unknown'), true)).data!.availability, 'unknown');
});

test('signed-in free and expired subscriptions receive a target-independent teaser without dish or macro data', async () => {
  const query = `cuisineType=${tag}-exact&seed=locked`;
  const freeSample = await body(await GET(request(query, 'free')));
  assert.ok(freeSample.data);
  assert.equal(freeSample.meta.locked, true);
  assert.equal(freeSample.data.item, null);
  assert.equal(freeSample.data.macros, null);
  assert.equal(freeSample.data.fitScore, null);
  assert.equal(freeSample.meta.tolerance, null);
  const impossible = new NextRequest(`http://localhost/api/restaurants/shuffle?lat=21&lng=-41&calories=0&fat=0&maxCalories=0&excludeRecent=${ids[0]}-a,${ids[0]}-b&${query}`,
    { headers: { 'x-forwarded-for': '192.0.2.145', authorization: `Bearer ${freeToken}` } });
  assert.deepEqual(await body(await GET(impossible)), freeSample);
  await prisma.subscription.update({ where: { userId }, data: { expiresAt: new Date('2000-01-01') } });
  try { assert.deepEqual(await body(await GET(request(query))), freeSample); }
  finally { await prisma.subscription.update({ where: { userId }, data: { expiresAt: null } }); }
});

test('cached paid data is never returned after entitlement expires', async () => {
  const query = `cuisineType=${tag}-exact&seed=cache-expiry`;
  const paid = await body(await GET(request(query)));
  assert.ok(paid.data!.macros);
  assert.deepEqual(await body(await GET(request(query))), paid);
  await prisma.subscription.update({ where: { userId }, data: { expiresAt: new Date('2000-01-01') } });
  try {
    const locked = await body(await GET(request(query)));
    assert.equal(locked.meta.locked, true);
    assert.equal(locked.data!.macros, null);
    assert.equal(locked.data!.item, null);
  } finally { await prisma.subscription.update({ where: { userId }, data: { expiresAt: null } }); }
});

test('exhausted budgets and uncovered locations return explicit empty results', async () => {
  assert.equal((await findShuffle({ ...params(), targets: { fatG: 0 } }, true)).data, null);
  const empty = await body(await GET(request('cuisineType=uncovered-' + tag)));
  assert.equal(empty.data, null);
  assert.equal(empty.meta.emptyReason, 'no_matches');
});

test('invalid input returns 400 and bound SQL treats filter strings as data', async () => {
  for (const query of ['radius=51', 'protein=NaN', 'maxCalories=-1', 'excludeRecent=a,,b']) {
    const response = await GET(new NextRequest(`http://localhost/api/restaurants/shuffle?lat=21&lng=-41&calories=600&${query}`, { headers: { authorization: `Bearer ${token}` } }));
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const result = await findShuffle({ ...params(), cuisineType: "x' OR true --" }, true);
  assert.equal(result.data, null);
  // Confirm fixtures still exist after passing adversarial text to the actual query.
  assert.equal((await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) FROM "Restaurant" WHERE id = ANY(${ids}::text[])`))[0]!.count, 6n);
});

test('rate limits count cache hits per user even when their IP changes, and include retry information', async () => {
  const query = `cuisineType=${tag}-exact&seed=rate-limit`;
  let limited: Response | undefined;
  for (let i = 0; i < 31; i++) {
    const response = await GET(request(query));
    if (response.status === 429) { limited = response; break; }
    assert.equal(response.status, 200);
  }
  assert.ok(limited);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal((await GET(request(query, true, '192.0.2.146'))).status, 429);
  assert.equal((await GET(request(query, 'free', '192.0.2.147'))).status, 200);
});
