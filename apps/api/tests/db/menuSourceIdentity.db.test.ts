import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import capture from '../fixtures/menu-source-identity.json';
import { parseStoreV1Response } from '../../services/menuSources/ueApiClient';
import { getMenuPage } from '../../lib/restaurantMenuService';
import { persistItems, type ValidatedPair } from '../../../../scripts/pipeline-utils';
import { persistHex } from '../../../../scripts/hex-persist';
import { validateHexInTx } from '../../../../scripts/preload-invariants';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
suite('source identity through ingestion, persistence, served menus and saved dishes', () => {
  const p = new PrismaClient(), scope = randomUUID();
  const ids: string[] = [];
  const products = parseStoreV1Response(capture)!.items;
  const pairs: ValidatedPair[] = products.map(item => ({ item, macro: {
    calories: item.price! > 50 ? 1600 : 400, proteinG: 20, carbsG: 50, fatG: 13,
    source: 'haiku', confidence: 'LOW', dietaryTags: [],
  } }));
  async function restaurant() {
    const row = await p.restaurant.create({ data: { name: scope, address: 'LA fixture', lat: 34, lng: -118,
      storeUuid: randomUUID(), source: 'fixture', cuisineTags: [] } });
    ids.push(row.id);
    return row;
  }
  async function write(id: string, input: ValidatedPair[], bulk: boolean) {
    return bulk ? persistHex(scope, randomUUID(), [{ restaurantId: id, items: input, menuHash: scope }], p,
      { validateInTx: validateHexInTx }) : persistItems(id, input, p);
  }
  beforeAll(async () => { await p.user.create({ data: { id: scope, email: `${scope}@identity.test` } }); });
  afterAll(async () => {
    await p.user.deleteMany({ where: { id: scope } });
    await p.restaurant.deleteMany({ where: { id: { in: ids } } });
    await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
    await p.$disconnect();
  });

  test.each([false, true])('same-name variants serve distinct macros and rerun with stable saved IDs (bulk=%s)', async bulk => {
    const r = await restaurant();
    expect(pairs).toHaveLength(2);
    // Start with the original legacy dish and a saved/logged reference.
    await write(r.id, [{ ...pairs[0]!, item: { ...pairs[0]!.item, sourceItemId: undefined } }], bulk);
    const legacy = await p.menuItem.findFirstOrThrow({ where: { restaurantId: r.id } });
    const saved = await p.savedItem.create({ data: { userId: scope, restaurantId: r.id, menuItemId: legacy.id, itemType: 'menu_item' } });
    expect(await write(r.id, [...pairs, pairs[0]!], bulk)).toBe(2);
    const first = (await getMenuPage(p, r.id, { limit: 250 }))!;
    expect(first.totalItemCount).toBe(2);
    expect(first.menuItems.map(i => i.macros!.calories).sort((a, b) => a - b)).toEqual([400, 1600]);
    expect(first.menuItems.find(i => i.price === pairs[0]!.item.price)!.id).toBe(legacy.id);
    expect(new Set(first.menuItems.map(i => i.id)).size).toBe(2);
    await write(r.id, [...pairs].reverse(), !bulk);
    const summary = (menu: typeof first) => menu.menuItems.map(i => ({ id: i.id, name: i.name, price: i.price, calories: i.macros?.calories }));
    expect(summary((await getMenuPage(p, r.id, { limit: 250 }))!)).toEqual(summary(first));
    expect(await p.macroEstimate.count({ where: { menuItem: { restaurantId: r.id } } })).toBe(2);
    expect((await p.savedItem.findUniqueOrThrow({ where: { id: saved.id } })).menuItemId).toBe(legacy.id);
    // Removal retires the row without destroying its reference; reappearance revives it.
    await write(r.id, [pairs[1]!], bulk);
    expect((await getMenuPage(p, r.id))!.totalItemCount).toBe(1);
    expect((await p.menuItem.findUniqueOrThrow({ where: { id: legacy.id } })).retiredAt).not.toBeNull();
    expect((await p.savedItem.findUniqueOrThrow({ where: { id: saved.id } })).menuItemId).toBe(legacy.id);
    await write(r.id, pairs, bulk);
    expect((await p.menuItem.findUniqueOrThrow({ where: { id: legacy.id } })).retiredAt).toBeNull();
    const renamed = { ...pairs[0]!, item: { ...pairs[0]!.item, name: 'Alfredo Linguine (Individual)', price: 19 } };
    await write(r.id, [renamed, pairs[1]!], bulk);
    expect((await getMenuPage(p, r.id))!.menuItems.find(i => i.id === legacy.id)!.name).toBe(renamed.item.name);
    const other = await restaurant();
    await write(other.id, pairs, bulk);
    expect((await getMenuPage(p, other.id))!.menuItems.map(i => i.id)).not.toContain(legacy.id);
  });

  test('ambiguous legacy rows keep their ID and macros but leave discovery', async () => {
    const r = await restaurant(), pair = pairs[0]!;
    await write(r.id, [{ ...pair, item: { ...pair.item, sourceItemId: undefined } }], false);
    const old = await p.menuItem.findFirstOrThrow({ where: { restaurantId: r.id } });
    await p.savedItem.create({ data: { userId: scope, restaurantId: r.id, menuItemId: old.id, itemType: 'menu_item' } });
    await write(r.id, [pair, { ...pair, item: { ...pair.item, sourceItemId: 'ubereats:ambiguous-second' } }], true);
    expect((await getMenuPage(p, r.id))!.totalItemCount).toBe(2);
    expect((await getMenuPage(p, r.id))!.menuItems.map(i => i.id)).not.toContain(old.id);
    expect(await p.menuItem.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ sourceItemId: null, calories: old.calories, retiredAt: expect.any(Date) });
  });

  test('concurrent writers cannot duplicate products and empty input cannot retire a menu', async () => {
    const r = await restaurant();
    await Promise.all([write(r.id, pairs, true), write(r.id, [...pairs].reverse(), false)]);
    const before = (await getMenuPage(p, r.id))!;
    expect(before.totalItemCount).toBe(2);
    await write(r.id, [], false);
    await write(r.id, [], true);
    expect((await getMenuPage(p, r.id))!.menuItems).toEqual(before.menuItems);
  });
});
