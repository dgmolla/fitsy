import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { guidedPreviewResponseSchema, restaurantsResponseSchema } from '@fitsy/shared';
import { GET as preview } from '../../app/api/restaurants/preview/route';
import { GET as search } from '../../app/api/restaurants/route';
import { prisma } from '../../lib/restaurantService';
import { token } from './authenticated-route.fixture';
after(() => prisma.$disconnect());

const targets = 'calories=600&protein=40&carbs=60&fat=20';
const at = 'lat=45&lng=45';
let requestNumber = 0;
const request = (path: string, query: string) => new NextRequest(`http://localhost/api/restaurants${path}?${query}`, {
  headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': `192.0.2.${++requestNumber}` },
});
const guided = async (query = targets, coordinates = at) => {
  const response = await preview(request('/preview', `${coordinates}&guided=1&${query}`));
  assert.equal(response.status, 200);
  return guidedPreviewResponseSchema.parse(await response.json());
};
const standard = async (query: string) => {
  const response = await search(request('', `${at}&${query}`));
  assert.equal(response.status, 200);
  return restaurantsResponseSchema.parse(await response.json());
};
const meal = (id: string, name: string, calories = 600, proteinG = 40, carbsG = 60, fatG = 20) =>
  ({ id, name, calories, proteinG, carbsG, fatG });

test('real guided and authenticated search preserve craving, target, selection and location context', async t => {
  const prefix = randomUUID();
  const ids = ['a', 'b', 'c', 'd', 'far'].map(suffix => `${prefix}-${suffix}`);
  const items = [
    [meal(`${prefix}-rice`, 'Chicken rice'), meal(`${prefix}-ramen-a`, 'Chicken Ramen', 630, 42, 60, 21),
      meal(`${prefix}-ramen-a-tie`, 'Chicken Ramen Large', 630, 42, 60, 21), meal(`${prefix}-pizza-a`, 'Chicken Pizza'),
      meal(`${prefix}-tiny-rice`, 'Tiny rice', 50)],
    [meal(`${prefix}-ramen-b`, 'Beef Ramen'), meal(`${prefix}-pizza-b`, 'Beef Pizza', 700),
      meal(`${prefix}-light-ramen`, 'Light Ramen', 400), meal(`${prefix}-protein-ramen`, 'Protein Ramen', 600, 70)],
    [meal(`${prefix}-ramen-c`, 'Tofu Ramen')],
    [meal(`${prefix}-burrito`, 'Chicken Burrito')],
    [meal(`${prefix}-far`, 'Far Ramen')],
  ];
  await prisma.$transaction(ids.map((id, i) => prisma.restaurant.create({ data: {
    id, storeUuid: id, name: ['Ramen Kitchen', 'Noodle House', 'Soup Counter', 'Chipotle Mexican Grill - Local', 'Far Ramen'][i]!,
    address: 'Synthetic endpoint fixture', source: 'test', lat: i === 4 ? 46 : 45, lng: 45,
    cuisineTags: i === 3 ? ['mexican'] : [], menuItems: { create: items[i]! },
  } })));
  try {
    await t.test('top three and count use qualifying ramen, with deterministic item and restaurant ties', async () => {
      const result = await guided(`${targets}&q=ramen`);
      assert.deepEqual(result.data.map(row => row.bestMatch!.menuItemId),
        [`${prefix}-ramen-b`, `${prefix}-ramen-c`, `${prefix}-ramen-a`]);
      assert.equal(result.meta.nearbyDishCount, 11);
      assert.deepEqual(result.meta.goalMatch, {
        policy: 'within-20-percent-v1', activeTargets: { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 },
        matchingDishCount: 4, additionalDishCount: 4, selectedItemMatches: false,
      });
      assert.deepEqual(await guided(`${targets}&q=ramen`), result);
      assert.equal(result.data[0]!.bestMatch!.nutritionBasis, 'estimated');
      assert.equal(result.data[0]!.bestMatch!.confidence, 'LOW');
    });
    await t.test('changing target and craving changes both ranked picks and qualifying count', async () => {
      const protein = await guided('calories=600&protein=70&carbs=60&fat=20&q=ramen');
      assert.deepEqual(protein.data.map(row => row.bestMatch!.menuItemId), [`${prefix}-protein-ramen`]);
      assert.equal(protein.meta.goalMatch!.matchingDishCount, 1);
      const pizza = await guided(`${targets}&q=pizza`);
      assert.deepEqual(pizza.data.map(row => row.bestMatch!.menuItemId), [`${prefix}-pizza-a`, `${prefix}-pizza-b`]);
      assert.equal(pizza.meta.goalMatch!.matchingDishCount, 2);
      const light = await guided('calories=400&protein=40&carbs=60&fat=20&q=ramen');
      assert.deepEqual(light.data.map(row => row.bestMatch!.menuItemId), [`${prefix}-light-ramen`]);
    });
    await t.test('standard search shares dish-first relevance and keeps subscription redaction', async () => {
      for (const craving of ['ramen', 'pizza']) {
        const result = await standard(`${targets}&q=${craving}`);
        assert.ok(result.data.length > 0);
        assert.ok(result.data.every(row => row.bestMatch!.name.toLowerCase().includes(craving)));
      }
      const locked = await search(new NextRequest(`http://localhost/api/restaurants?${at}&${targets}&q=ramen`));
      const result = restaurantsResponseSchema.parse(await locked.json());
      assert.equal(result.meta.locked, true);
      assert.ok(result.data.length > 0);
      assert.ok(result.data.every(row => row.bestMatch === null));
    });
    await t.test('partial restaurant, cuisine and exact full restaurant queries remain useful', async () => {
      for (const query of ['chipotle', 'mexican']) {
        const result = await guided(`${targets}&q=${query}`);
        assert.deepEqual(result.data.map(row => row.bestMatch!.menuItemId), [`${prefix}-burrito`]);
        assert.deepEqual((await standard(`${targets}&q=${query}`)).data.map(row => row.id), [ids[3]]);
      }
      const exact = await guided(`${targets}&q=${encodeURIComponent('  RAMEN   Kitchen  ')}`);
      assert.deepEqual(exact.data.map(row => row.id), [ids[0]]);
      assert.equal(exact.meta.goalMatch!.matchingDishCount, 4);
    });
    await t.test('zero target matches never fall back to unrelated dishes and differ from no coverage', async () => {
      const noFit = await guided('calories=50&protein=40&carbs=60&fat=20&q=ramen');
      assert.deepEqual(noFit.data, []);
      assert.equal(noFit.meta.nearbyDishCount, 11);
      assert.equal(noFit.meta.goalMatch!.matchingDishCount, 0);
      const noCraving = await guided(`${targets}&q=unfindablecravingxyz`);
      assert.deepEqual(noCraving.data, []);
      assert.equal(noCraving.meta.nearbyDishCount, 11);
      assert.equal(noCraving.meta.goalMatch!.matchingDishCount, 0);
      const noArea = await guided(targets, 'lat=-45&lng=-45');
      assert.deepEqual(noArea.data, []);
      assert.equal(noArea.meta.nearbyDishCount, 0);
      assert.equal(noArea.meta.goalMatch!.matchingDishCount, 0);
    });
    await t.test('only a selected visible dish is subtracted; hidden item IDs reveal no membership', async () => {
      const original = await guided(`${targets}&q=ramen`);
      for (const selected of [`${prefix}-ramen-a`, `${prefix}-ramen-c`]) {
        const result = await guided(`${targets}&q=ramen&selectedItemId=${selected}`);
        assert.deepEqual(result.data, original.data);
        assert.equal(result.meta.goalMatch!.selectedItemMatches, true);
        assert.equal(result.meta.goalMatch!.additionalDishCount, 3);
      }
      for (const selected of [`${prefix}-ramen-a-tie`, `${prefix}-far`, `${prefix}-rice`, `${prefix}-protein-ramen`, 'unknown']) {
        const result = await guided(`${targets}&q=ramen&selectedItemId=${selected}`);
        assert.deepEqual(result.data, original.data);
        assert.equal(result.meta.goalMatch!.selectedItemMatches, false);
        assert.equal(result.meta.goalMatch!.additionalDishCount, 4);
      }
      const zero = await guided(`${targets}&q=unknown&selectedItemId=${prefix}-ramen-c`);
      assert.equal(zero.meta.goalMatch!.additionalDishCount, 0);
      assert.equal(zero.meta.goalMatch!.selectedItemMatches, false);
    });
    await t.test('zero and absent targets retain discovery without making a goal-match claim', async () => {
      const absent = await guided('q=ramen');
      assert.equal(absent.meta.goalMatch, null);
      assert.ok(absent.data.length > 0);
      assert.ok(absent.data.every(row => row.bestMatch!.matchScore === null));
      assert.deepEqual(await guided('q=ramen&calories=0&protein=0'), absent);
    });
  } finally { await prisma.restaurant.deleteMany({ where: { id: { in: ids } } }); }
});

test('inclusive goal bounds apply to every active dimension and preserve only complete nutrition', async () => {
  const id = randomUUID();
  const rows = [
    meal(`${id}-lower`, 'Lower', 480, 32, 48, 16), meal(`${id}-upper`, 'Upper', 720, 48, 72, 24),
    meal(`${id}-calories`, 'Over calories', 721), meal(`${id}-protein`, 'Under protein', 600, 31.99),
    meal(`${id}-carbs`, 'Over carbs', 600, 40, 72.01), meal(`${id}-fat`, 'Over fat', 600, 40, 60, 24.01),
  ];
  await prisma.restaurant.create({ data: { id, storeUuid: id, name: 'Boundary fixture', address: 'Synthetic',
    source: 'test', lat: 45, lng: 45, cuisineTags: [], menuItems: { create: rows } } });
  await prisma.menuItem.create({ data: { restaurantId: id, name: 'Incomplete', calories: 600, carbsG: 60, fatG: 20 } });
  try {
    const full = await guided();
    assert.equal(full.meta.nearbyDishCount, 6);
    assert.equal(full.meta.goalMatch!.matchingDishCount, 2);
    assert.equal((await guided('calories=600')).meta.goalMatch!.matchingDishCount, 5);
    assert.equal((await guided('protein=40')).meta.goalMatch!.matchingDishCount, 5);
    assert.equal((await guided('carbs=60')).meta.goalMatch!.matchingDishCount, 5);
    assert.equal((await guided('fat=20')).meta.goalMatch!.matchingDishCount, 5);
  } finally { await prisma.restaurant.delete({ where: { id } }); }
});

test('opt-in main search matches preview picks and binds pagination to its goal context', async () => {
  const prefix = randomUUID();
  const ids = ['a', 'b', 'c', 'off'].map(suffix => `${prefix}-${suffix}`);
  await prisma.$transaction(ids.map((id, i) => prisma.restaurant.create({ data: {
    id, storeUuid: id, name: `Parity fixture ${i}`, address: 'Synthetic', source: 'test', lat: 45, lng: 45,
    cuisineTags: [], menuItems: { create: i === 3
      ? meal(`${id}-meal`, 'Parity ramen off protein', 600, 48.4, 60, 20)
      : meal(`${id}-meal`, `Parity ramen ${i}`, 714, 47.6, 71.4, 23.8) },
  } })));
  try {
    const query = `${targets}&q=ramen`;
    const preview = await guided(query);
    const matched = await standard(`${query}&goalMatched=1&limit=3`);
    assert.equal(preview.meta.goalMatch!.matchingDishCount, 3);
    assert.deepEqual(matched.data.map(row => row.bestMatch!.menuItemId), preview.data.map(row => row.bestMatch!.menuItemId));
    assert.equal((await standard(`${query}&limit=3`)).data[0]!.id, ids[3], 'Legacy ranking remains available');
    const anonymous = async (flag: string) => restaurantsResponseSchema.parse(await (await search(
      new NextRequest(`http://localhost/api/restaurants?${at}&${query}&limit=3${flag}`))).json());
    const lockedLegacy = await anonymous('');
    const lockedFlag = await anonymous('&goalMatched=1');
    assert.ok(lockedLegacy.data.length > 0);
    assert.deepEqual(lockedFlag, lockedLegacy, 'Goal qualification must not expose locked dish membership');
    assert.ok(lockedFlag.data.every(row => row.bestMatch === null));

    const first = await standard(`${query}&goalMatched=1&limit=1`);
    assert.ok(first.meta.nextCursor);
    const cursor = `cursor=${encodeURIComponent(first.meta.nextCursor)}`;
    const next = await standard(`${query}&goalMatched=1&limit=1&${cursor}`);
    assert.equal(next.data[0]!.id, ids[1]);
    const aliases = await standard(`calories=600&proteinG=40&carbsG=60&fatG=20&q=%20RAMEN%20&goalMatched=1&limit=1&${cursor}`);
    assert.deepEqual(aliases, next, 'Equivalent aliases and normalized craving share context');
    for (const changed of [
      `calories=601&protein=40&carbs=60&fat=20&q=ramen&goalMatched=1`,
      `${targets}&q=pizza&goalMatched=1`, `${query}&goalMatched=0`,
      `${query}&goalMatched=1&radius=4`, `${query}&goalMatched=1&chainOnly=true`,
      `${query}&goalMatched=1&dietary=vegan`, `${query}&goalMatched=1&maxPriceLevel=$`,
      `${query}&goalMatched=1&minRating=4`, `${query}&goalMatched=1&cuisineType=japanese`,
    ]) {
      assert.equal((await search(request('', `${at}&${changed}&${cursor}`))).status, 400, changed);
    }
    assert.equal((await search(request('', `lat=45.01&lng=45&${query}&goalMatched=1&${cursor}`))).status, 400);
    const legacy = await standard(`${query}&limit=1`);
    assert.equal((await search(request('', `${at}&${query}&goalMatched=1&cursor=${encodeURIComponent(legacy.meta.nextCursor!)}`))).status, 400);
    for (const flag of ['true', '2', '', '1&goalMatched=0']) {
      assert.equal((await search(request('', `${at}&${query}&goalMatched=${flag}`))).status, 400);
    }
    for (const context of [42, 'invalid', null]) {
      const malformed = Buffer.from(JSON.stringify({ id: ids[0], orderKey: 0, context })).toString('base64url');
      const invalid = await search(request('', `${at}&${query}&goalMatched=1&cursor=${malformed}`));
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { error: 'Invalid cursor' });
    }
    assert.deepEqual(await standard('goalMatched=1&calories=0&limit=1'), await standard('limit=1'));
  } finally { await prisma.restaurant.deleteMany({ where: { id: { in: ids } } }); }
});

test('a craving never falls back inside a name-only restaurant when another restaurant has that dish', async () => {
  const a = randomUUID(), b = randomUUID();
  await prisma.$transaction([
    prisma.restaurant.create({ data: { id: a, storeUuid: a, name: 'Ramen Kitchen', address: 'Synthetic', source: 'test',
      lat: 45, lng: 45, cuisineTags: [], menuItems: { create: meal(`${a}-chicken`, 'Chicken rice') } } }),
    prisma.restaurant.create({ data: { id: b, storeUuid: b, name: 'Soup Counter', address: 'Synthetic', source: 'test',
      lat: 45, lng: 45, cuisineTags: [], menuItems: { create: meal(`${b}-ramen`, 'Turkey ramen wrap') } } }),
  ]);
  try {
    const craving = `${targets}&q=ramen`;
    assert.deepEqual((await guided(craving)).data.map(row => row.id), [b]);
    assert.deepEqual((await standard(`${craving}&goalMatched=1`)).data.map(row => row.id), [b]);
    const restaurant = `${targets}&q=Ramen%20Kitchen`;
    assert.deepEqual((await guided(restaurant)).data.map(row => row.id), [a]);
    assert.deepEqual((await standard(`${restaurant}&goalMatched=1`)).data.map(row => row.id), [a]);
    // Now the full restaurant name also matches another restaurant's dish.
    // Only the exact-name override can retain this restaurant's unrelated menu item.
    await prisma.restaurant.update({ where: { id: a }, data: { name: 'Turkey ramen wrap' } });
    const exact = `${targets}&q=Turkey%20ramen%20wrap`;
    const expected = [a, b].sort();
    assert.deepEqual((await guided(exact)).data.map(row => row.id), expected);
    assert.deepEqual((await standard(`${exact}&goalMatched=1`)).data.map(row => row.id), expected);
  } finally { await prisma.restaurant.deleteMany({ where: { id: { in: [a, b] } } }); }
});
