import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { restaurantsResponseSchema, menuResponseSchema } from '@fitsy/shared';
import { GET } from '../../app/api/restaurants/route';
import { GET as preview } from '../../app/api/restaurants/preview/route';
import { GET as menu } from '../../app/api/restaurants/[id]/menu/route';
import type { RestaurantResult } from '@fitsy/shared';
import { prisma } from '../../lib/restaurantService';

// Native ESM runner supports jose. Real handlers, JWT verification and Postgres.
const keys = createServer();
const userId = randomUUID();
let token: string;
const restaurantIds = [randomUUID(), randomUUID()];
const targets = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };
before(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'ES256', use: 'sig' };
  keys.on('request', (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>(resolve => keys.listen(0, 'localhost', resolve));
  const address = keys.address();
  assert.ok(address && typeof address !== 'string');
  process.env['SUPABASE_URL'] = `http://localhost:${address.port}`;
  delete process.env['ALLOW_STUB_SUBSCRIPTIONS'];
  delete process.env['DEMO_REVIEW_EMAILS'];
  const email = `${userId}@example.test`;
  await prisma.user.create({ data: { id: userId, email,
    subscription: { create: { plan: 'monthly', status: 'active' } } } });
  for (const id of restaurantIds) {
    await prisma.restaurant.create({ data: { id, storeUuid: id, name: 'Menu regression',
      address: 'Local fixture', lat: 12, lng: 12, source: 'test', cuisineTags: [],
      menuItems: { create: Array.from({ length: 251 }, (_, i) => ({
        id: `${id}-${String(i + 1).padStart(3, '0')}`,
        name: i === 250 ? 'Zucchini chicken' : `A dish ${i + 1}`,
        ...(i === 250 ? targets : { calories: 900, proteinG: 10, carbsG: 100, fatG: 50 }),
        macroEstimates: { create: { ...targets, source: 'haiku', confidence: 'MEDIUM' } },
      })) } } });
    await prisma.macroEstimate.create({ data: { menuItemId: `${id}-251`, ...targets,
      source: 'merchant', confidence: 'HIGH', estimatedAt: new Date('2026-01-01') } });
  }
  token = await new SignJWT({ email }).setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
    .setSubject(userId).setIssuer(`${process.env['SUPABASE_URL']}/auth/v1`)
    .setAudience('authenticated').setExpirationTime('5m').sign(privateKey);
});
after(async () => {
  await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => keys.close(err => err ? reject(err) : resolve()));
});
const request = (query: string, authenticated = true) => new NextRequest(
  `http://localhost/api/restaurants?lat=34.05&lng=-118.25&${query}`,
  authenticated ? { headers: { authorization: `Bearer ${token}` } } : {},
);

test('real authenticated search accepts equivalent aliases and keeps a valid wire contract', async () => {
  const short = await GET(request('calories=600&protein=40&carbs=60&fat=20'));
  const grams = await GET(request('calories=600&proteinG=40&carbsG=60&fatG=20'));
  assert.equal(short.status, 200);
  assert.equal(grams.status, 200);
  const a = await short.json(), b = await grams.json();
  assert.ok(a.data.length > 0, 'seed restaurants must exist');
  assert.equal(a.meta.locked, false);
  assert.ok(a.data[0].bestMatch);
  assert.deepEqual(a, b);
  assert.equal(restaurantsResponseSchema.safeParse(a).success, true);
});

test('invalid targets return 400 through the handler', async () => {
  for (const q of ['protein=NaN', 'protein=1e-300', 'protein=1e-400', 'carbs=%20', 'fatG=-1', 'calories=', 'protein=40&proteinG=50']) {
    assert.equal((await GET(request(q))).status, 400, q);
  }
});

test('unauthenticated search still strips every best match', async () => {
  const response = await GET(request('proteinG=40', false));
  assert.equal(response.status, 200);
  const { data, meta } = await response.json();
  assert.ok(data.length > 0);
  assert.equal(meta.locked, true);
  assert.ok(data.every((row: { bestMatch?: unknown }) => !row.bestMatch));
});

const getMenu = (id: string, query = '', authenticated = true) => menu(new NextRequest(
  `http://localhost/api/restaurants/${id}/menu?${query}`,
  authenticated ? { headers: { authorization: `Bearer ${token}` } } : {},
), { params: Promise.resolve({ id }) });
const targetQuery = 'calories=600&protein=40&carbs=60&fat=20';
const body = async (response: Response) => {
  assert.equal(response.status, 200);
  return menuResponseSchema.parse((await response.json()).data);
};

test('search and detail agree beyond the old 200-item alphabetical cap, with winning metadata', async () => {
  const response = await GET(new NextRequest(`http://localhost/api/restaurants?lat=12&lng=12&${targetQuery}`,
    { headers: { authorization: `Bearer ${token}` } }));
  const results = (await response.json()).data as RestaurantResult[];
  for (const id of restaurantIds) {
    const best = results.find(r => r.id === id)!.bestMatch!;
    for (const query of [targetQuery, 'calories=600&proteinG=40&carbsG=60&fatG=20']) {
      const detail = await body(await getMenu(id, query));
      assert.equal(best.menuItemId, `${id}-251`);
      assert.equal(detail.menuItems[0]!.id, best.menuItemId);
      for (const key of ['calories', 'proteinG', 'carbsG', 'fatG', 'confidence'] as const) {
        assert.equal(detail.menuItems[0]!.macros![key], best[key]);
      }
      assert.equal(best.confidence, 'HIGH');
      assert.equal(detail.totalItemCount, 251);
      assert.equal(detail.menuItems.length, 200, 'preserve legacy page size');
    }
  }
});

test('all 251 IDs remain reachable exactly once, including with smaller pages', async () => {
  const id = restaurantIds[0]!;
  let page = await body(await getMenu(id, `${targetQuery}&pageSize=100`));
  const ids: string[] = [];
  do {
    assert.equal(page.totalItemCount, 251);
    ids.push(...page.menuItems.map(item => item.id));
    if (!page.nextCursor) break;
    page = await body(await getMenu(id, `${targetQuery}&pageSize=100&cursor=${page.nextCursor}`));
  } while (true);
  assert.equal(ids.length, 251);
  assert.equal(new Set(ids).size, 251);
  assert.ok(Array.from({ length: 251 }, (_, i) => `${id}-${String(i + 1).padStart(3, '0')}`).every(x => ids.includes(x)));
});

test('cursor is bound to restaurant, target values and selection', async () => {
  const id = restaurantIds[0]!;
  const first = await body(await getMenu(id, `${targetQuery}&pageSize=100`));
  assert.ok(first.nextCursor);
  const suffix = `&cursor=${first.nextCursor}`;
  assert.equal((await getMenu(restaurantIds[1]!, targetQuery + suffix)).status, 400);
  assert.equal((await getMenu(id, 'calories=500' + suffix)).status, 400);
  assert.equal((await getMenu(id, targetQuery + suffix + '&selectedItemId=another')).status, 400);
  assert.equal((await getMenu(id, 'cursor=garbage')).status, 400);
  for (const score of ['1e-400', '-1e-400', '1e400', '-1e400']) {
    const invalid = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
    invalid.score = score;
    assert.equal((await getMenu(id, targetQuery + '&cursor=' + Buffer.from(JSON.stringify(invalid)).toString('base64url'))).status, 400);
  }
});

test('selection pins the searched item without losing or repeating rows', async () => {
  const id = restaurantIds[0]!;
  const chosen = `${id}-200`;
  const first = await body(await getMenu(id, `${targetQuery}&selectedItemId=${chosen}&pageSize=1`));
  assert.equal(first.menuItems[0]!.id, chosen);
  assert.ok(first.nextCursor);
  const next = await body(await getMenu(id, `${targetQuery}&selectedItemId=${chosen}&pageSize=1&cursor=${first.nextCursor}`));
  assert.equal(next.menuItems[0]!.id, `${id}-251`);
});

test('invalid targets and page sizes return 400 on detail too', async () => {
  for (const query of ['protein=NaN', 'protein=1e-300', 'protein=1e-400', 'fatG=-1', 'calories=', 'protein=40&proteinG=50',
    'pageSize=0', 'pageSize=251', 'pageSize=1.5', 'pageSize=']) {
    assert.equal((await getMenu(restaurantIds[0]!, query)).status, 400, query);
  }
});

test('locked callers cannot enumerate dishes using targets, selection, page size or cursors', async () => {
  const id = restaurantIds[0]!;
  const first = await body(await getMenu(id, '', false));
  assert.equal(first.locked, true);
  assert.equal(first.menuItems.length, 3);
  assert.equal(first.totalItemCount, 251);
  for (const query of [targetQuery, 'selectedItemId=' + id + '-251', 'cursor=garbage', 'pageSize=250']) {
    const data = await body(await getMenu(id, query, false));
    assert.deepEqual(data, first);
    assert.equal(data.nextCursor, null);
  }
  await prisma.subscription.update({ where: { userId }, data: { expiresAt: new Date('2000-01-01') } });
  assert.deepEqual(await body(await getMenu(id, targetQuery)), first);
  await prisma.subscription.update({ where: { userId }, data: { expiresAt: null } });
});

test('zero targets agree; empty pages keep the real total; unknown restaurants return 404', async () => {
  const id = restaurantIds[0]!;
  assert.deepEqual(await body(await getMenu(id, 'calories=0')), await body(await getMenu(id)));
  const first = await body(await getMenu(id));
  assert.ok(first.nextCursor);
  const cursor = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
  cursor.score = '1e101';
  const empty = await body(await getMenu(id, 'cursor=' + Buffer.from(JSON.stringify(cursor)).toString('base64url')));
  assert.equal(empty.menuItems.length, 0);
  assert.equal(empty.totalItemCount, 251);
  assert.equal(empty.nextCursor, null);
  assert.equal((await getMenu(randomUUID())).status, 404);
});

test('onboarding preview uses the same aliases and rejects invalid targets without exposing matches', async () => {
  const a = await preview(request('calories=600&protein=40&carbs=60&fat=20', false));
  const b = await preview(request('calories=600&proteinG=40&carbsG=60&fatG=20', false));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const data = await a.json();
  assert.ok(data.data.length > 0);
  assert.deepEqual(data, await b.json());
  assert.ok(data.data.every((row: object) => !('bestMatch' in row)));
  for (const query of ['protein=NaN', 'protein=1e-300', 'protein=1e-400', 'carbs=%20', 'proteinG=-1', 'calories=', 'protein=40&proteinG=50']) {
    assert.equal((await preview(request(query, false))).status, 400, query);
  }
});

// JavaScript silently rounds these to zero; PostgreSQL rejects the float cast.
test('out-of-range cursor numbers are client errors, while genuine zero is accepted', async () => {
  for (const orderKeyText of ['1e-400', '-1e-400', '1e400', '-1e400', '0']) {
    const cursor = Buffer.from(JSON.stringify({ id: 'x', orderKey: 0, orderKeyText })).toString('base64');
    assert.equal((await GET(request('cursor=' + encodeURIComponent(cursor)))).status, orderKeyText === '0' ? 200 : 400);
  }
});

test('search and detail expose the same LOW confidence when provenance is missing', async () => {
  const id = restaurantIds[0]!;
  await prisma.macroEstimate.deleteMany({ where: { menuItemId: `${id}-251` } });
  const response = await GET(new NextRequest(`http://localhost/api/restaurants?lat=12&lng=12&${targetQuery}`,
    { headers: { authorization: `Bearer ${token}` } }));
  const results = (await response.json()).data as RestaurantResult[];
  const best = results.find(r => r.id === id)!.bestMatch!;
  const detail = await body(await getMenu(id, targetQuery));
  assert.equal(best.confidence, 'LOW');
  assert.equal(detail.menuItems[0]!.id, best.menuItemId);
  assert.equal(detail.menuItems[0]!.macros!.confidence, 'LOW');
  assert.equal(detail.menuItems[0]!.macros!.calories, best.calories);
});
