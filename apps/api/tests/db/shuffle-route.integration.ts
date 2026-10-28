import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { restaurantsResponseSchema, GOAL_MATCH_TOLERANCE } from '@fitsy/shared';
import { GET } from '../../app/api/restaurants/route';
import { prisma, findNearbyRestaurants, decodeCursor } from '../../lib/restaurantService';
import { userId, token, freeToken } from './authenticated-route.fixture';

const tag = randomUUID();
const ids = Array.from({ length: 65 }, (_, i) => `${tag}-${i}`);
const invalidIds = ['over', 'under', 'far', 'cuisine', 'chain', 'diet', 'price', 'rating', 'retired', 'incomplete', 'query'].map(id => `${tag}-${id}`);
const targets = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };
const base = `lat=21&lng=-41&calories=600&protein=40&carbs=60&fat=20&cuisineType=${tag}&chainOnly=true&dietary=vegan&maxPriceLevel=$$&minRating=4&q=bowl`;
const options = { lat: 21, lng: -41, radiusMiles: 3, targets, cuisineType: tag, chainOnly: true,
  dietary: 'vegan', maxPriceLevel: '$$', minRating: 4, query: 'bowl', limit: 20 };
const request = (query = '', auth: boolean | 'free' = true) => new NextRequest(
  `http://localhost/api/restaurants?${base}&${query}`,
  { headers: auth ? { authorization: `Bearer ${auth === 'free' ? freeToken : token}` } : {} },
);
const body = async (response: Response) => {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return restaurantsResponseSchema.parse(await response.json());
};
const exclude = (values: string[]) => `excludeRestaurantIds=${encodeURIComponent(values.join(','))}`;

before(async () => {
  for (const id of [...ids, ...invalidIds]) {
    const kind = id.slice(tag.length + 1);
    const factor = ids.includes(id) ? [0.81, 1, 1.19][Number(kind) % 3]! : 1;
    const macros = kind === 'over' ? { calories: 900, proteinG: 10, carbsG: 100, fatG: 50 }
      : kind === 'under' ? { calories: 100, proteinG: 5, carbsG: 10, fatG: 2 }
      : { calories: targets.calories * factor, proteinG: targets.proteinG * factor,
        carbsG: targets.carbsG * factor, fatG: targets.fatG * factor };
    await prisma.restaurant.create({ data: {
      id, storeUuid: id, name: 'Shuffle fixture', address: 'Isolated fixture', source: 'test',
      lat: kind === 'far' ? 22 : 21, lng: -41, cuisineTags: kind === 'cuisine' ? [] : [tag],
      chainFlag: kind !== 'chain', dietaryOptions: kind === 'diet' ? [] : ['has_vegan'],
      priceLevel: kind === 'price' ? '$$$$' : '$$', rating: kind === 'rating' ? 2 : 4.5,
      menuItems: { create: [{ id: `${id}-dish`, name: kind === 'query' ? 'Unrelated meal' : 'Fixture bowl',
        ...macros, ...(kind === 'incomplete' ? { proteinG: null } : {}),
        ...(kind === 'retired' ? { retiredAt: new Date() } : {}), dietaryTags: ['vegan'],
        macroEstimates: { create: { ...macros, source: 'merchant', confidence: 'HIGH' } },
      }] },
    } });
  }
});
after(async () => {
  await prisma.restaurant.deleteMany({ where: { id: { in: [...ids, ...invalidIds] } } });
  await prisma.$disconnect();
});

test('search and two shuffles return separate pages of 20 fitting restaurants with the same contract', async () => {
  const search = await body(await GET(request()));
  const shown = search.data.map(row => row.id);
  const first = await body(await GET(request(`shuffle=1&seed=first&${exclude(shown)}`)));
  const second = await body(await GET(request(`shuffle=1&seed=second&${exclude([...shown, ...first.data.map(row => row.id)])}`)));
  assert.deepEqual(Object.keys(first.meta), Object.keys(search.meta));
  assert.equal(first.meta.locked, false);
  assert.equal(first.data.length, 20);
  assert.equal(second.data.length, 20);
  assert.equal(new Set([...shown, ...first.data.map(row => row.id), ...second.data.map(row => row.id)]).size, 60);
  for (const row of [...first.data, ...second.data]) {
    assert.ok(ids.includes(row.id), 'all restaurant, text, radius and nutrition filters must survive');
    for (const key of ['calories', 'proteinG', 'carbsG', 'fatG'] as const) {
      assert.ok(Math.abs(row.bestMatch![key] - targets[key]) / targets[key] <= GOAL_MATCH_TOLERANCE);
    }
  }
  if (process.env['FITSY_SHUFFLE_EVIDENCE_DIR']) {
    const directory = resolve(process.env['FITSY_SHUFFLE_EVIDENCE_DIR']);
    mkdirSync(directory, { recursive: true });
    for (const [name, response] of Object.entries({ search, shuffle: first, 'shuffle-again': second })) {
      writeFileSync(resolve(directory, `${name}.json`), JSON.stringify(response, null, 2) + '\n');
    }
  }
});

test('seeded pagination reaches each eligible restaurant exactly once and only repeats after new rows', async () => {
  const shuffle = { seed: 'pages', excludeRestaurantIds: ids.slice(0, 40) };
  const collected: string[] = [];
  let cursor;
  do {
    const page = await findNearbyRestaurants({ ...options, shuffle, ...(cursor ? { cursor } : {}) });
    collected.push(...page.data.map(row => row.id));
    cursor = page.nextCursor ? decodeCursor(page.nextCursor)! : undefined;
  } while (cursor);
  assert.equal(collected.length, ids.length);
  assert.equal(new Set(collected).size, ids.length);
  assert.ok(collected.slice(0, 25).every(id => !shuffle.excludeRestaurantIds.includes(id)));
  assert.ok(collected.slice(25).every(id => shuffle.excludeRestaurantIds.includes(id)));
  const first = await findNearbyRestaurants({ ...options, shuffle });
  assert.deepEqual(first, await findNearbyRestaurants({ ...options, shuffle }));
});

test('a shortage fills the page with repeats without relaxing targets or filters', async () => {
  const shuffle = { seed: 'shortage', excludeRestaurantIds: ids.slice(0, 60) };
  const page = await findNearbyRestaurants({ ...options, shuffle });
  assert.equal(page.data.length, 20);
  assert.equal(new Set(page.data.map(row => row.id)).size, 20);
  assert.ok(page.data.slice(0, 5).every(row => !shuffle.excludeRestaurantIds.includes(row.id)));
  assert.ok(page.data.slice(5).every(row => shuffle.excludeRestaurantIds.includes(row.id)));
  assert.ok(page.data.every(row => ids.includes(row.id)));
  const allSeen = await findNearbyRestaurants({ ...options, shuffle: { ...shuffle, excludeRestaurantIds: ids } });
  assert.equal(allSeen.data.length, 20);
});

test('cursor context binds seed, exclusions, filters, query, targets and shuffle mode', async () => {
  const first = await body(await GET(request('shuffle=1&seed=context')));
  const cursor = `cursor=${encodeURIComponent(first.meta.nextCursor!)}`;
  assert.equal((await GET(request(`shuffle=1&seed=context&${cursor}`))).status, 200);
  for (const query of ['shuffle=1&seed=changed', `shuffle=1&seed=context&${exclude([ids[0]!])}`, '',
    'shuffle=1&seed=context&radius=4', 'shuffle=1&seed=context&goalMatched=1']) {
    assert.equal((await GET(request(`${query}&${cursor}`))).status, 400, query);
  }
  const generated = await body(await GET(request('shuffle=1')));
  assert.ok(generated.meta.nextCursor);
  assert.equal((await GET(request(`shuffle=1&cursor=${encodeURIComponent(generated.meta.nextCursor!)}`))).status, 200);
});

test('locked search and shuffle retain identity but never expose paid matches or target membership', async () => {
  assert.equal((await GET(request('shuffle=1', false))).status, 401);
  const a = await body(await GET(request('shuffle=1&seed=locked', 'free')));
  assert.equal(a.meta.locked, true);
  assert.equal(a.data.length, 20);
  assert.ok(a.data.every(row => row.bestMatch === null));
  const changedTargets = new NextRequest(request('shuffle=1&seed=locked', 'free').url.replace('calories=600', 'calories=1'));
  const b = await body(await GET(new NextRequest(changedTargets, { headers: { authorization: `Bearer ${freeToken}` } })));
  assert.deepEqual(a, b);
});

test('direct shuffle requests reconcile missing, stale, renewed and denied RevenueCat proof', async () => {
  const originalFetch = global.fetch;
  process.env['REVENUECAT_PUBLIC_API_KEY'] = 'test_fixture';
  let lookups = 0;
  global.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.revenuecat.com/')) {
      assert.equal(String(input), `https://api.revenuecat.com/v1/subscribers/${userId}`);
      assert.equal(new Headers(init?.headers).get('x-is-sandbox'), 'true');
      lookups++;
      return Response.json({ request_date_ms: Date.now(), subscriber: {
        entitlements: { pro: { product_identifier: 'monthly', expires_date: new Date(Date.now() + 86_400_000).toISOString() } },
        subscriptions: { monthly: { store: 'test_store', is_sandbox: true } },
      } });
    }
    return originalFetch(input, init);
  };
  try {
    for (const scenario of ['stale', 'renewal', 'denied', 'missing']) {
      if (scenario === 'missing') await prisma.subscription.delete({ where: { userId } });
      else await prisma.subscription.update({ where: { userId }, data: {
        status: scenario === 'denied' ? 'never_subscribed' : 'active',
        expiresAt: scenario === 'renewal' ? new Date(Date.now() - 1000) : null,
        lastEventAt: new Date(Date.now() - (scenario === 'stale' ? 25 * 60 * 60 * 1000 : 2000)),
      } });
      const result = await body(await GET(request(`shuffle=1&seed=subscription-${scenario}`)));
      assert.equal(result.meta.locked, false, scenario);
      assert.ok(result.data[0]!.bestMatch?.menuItemId);
    }
    assert.equal(lookups, 4);
  } finally {
    global.fetch = originalFetch;
    delete process.env['REVENUECAT_PUBLIC_API_KEY'];
  }
});

test('empty matching pools return the search empty shape', async () => {
  const page = await findNearbyRestaurants({ ...options, targets: { calories: 1 }, shuffle: { seed: 'empty', excludeRestaurantIds: [] } });
  assert.deepEqual(page, { data: [], total: 0, nextCursor: null });
});
