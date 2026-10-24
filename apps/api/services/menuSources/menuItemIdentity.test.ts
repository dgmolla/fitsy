import capture from '../../tests/fixtures/menu-source-identity.json';
import { parseStoreV1Response } from './ueApiClient';
import { computeMenuHash, menuItemIdentity } from './menuItemIdentity';
import type Anthropic from '@anthropic-ai/sdk';
import { estimateMacros } from '../macroEstimationService';
import { dedupByIdentity, validateItems } from '../../../../scripts/pipeline-utils';

test('captured individual and family Alfredo Linguine remain separate source products', () => {
  const items = parseStoreV1Response(capture)!.items;
  expect(items).toHaveLength(2);
  expect(items.map(item => item.price).sort()).toEqual([18.39, 63.29]);
  expect(new Set(items.map(item => item.sourceItemId)).size).toBe(2);
});

test('source identity survives a title change, while missing and blank IDs fall back to decoded names', () => {
  expect(menuItemIdentity({ name: 'Old', sourceItemId: 'ubereats:one' }))
    .toBe(menuItemIdentity({ name: 'New', sourceItemId: 'ubereats:one' }));
  expect(menuItemIdentity({ name: 'Fish &amp; Chips', sourceItemId: ' ' }))
    .toBe(menuItemIdentity({ name: 'FISH & CHIPS' }));
  expect(menuItemIdentity({ name: 'source:ubereats:one' })).not.toBe(menuItemIdentity({ name: '', sourceItemId: 'ubereats:one' }));
});

test('incremental hashes include identity and serving context and ignore input ordering', () => {
  const items = parseStoreV1Response(capture)!.items;
  expect(computeMenuHash(items)).toBe(computeMenuHash([...items].reverse()));
  for (const patch of [{ sourceItemId: 'ubereats:new' }, { price: 1 }, { name: 'New' },
    { description: 'New serving' }, { section: 'Family' }, { category: 'Entree' }, { calories: 1500 }, { hasCustomizations: false }]) {
    expect(computeMenuHash([{ ...items[0]!, ...patch }, ...items.slice(1)])).not.toBe(computeMenuHash(items));
  }
});

test('the captured variants retain their paired estimates through the actual validation and deduplication path', async () => {
  const items = parseStoreV1Response(capture)!.items;
  // Only the external model response is synthetic. Every ingestion helper is real.
  const client = { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(
    [...items].reverse().map(item => ({ name: item.name, sourceItemId: item.sourceItemId,
      cal: 400, p: item.price! > 50 ? 80 : 20, c: 50, f: 10, conf: 'LOW' })),
  ) }] }) } } as unknown as Anthropic;
  const macros = await estimateMacros(items, client);
  const { valid } = validateItems(items, macros);
  const products = dedupByIdentity(valid);
  expect(products).toHaveLength(2);
  expect(products.map(pair => [pair.item.price, pair.macro.proteinG])).toEqual([[18.39, 20], [63.29, 80]]);
});

test('the same source product in multiple placements deduplicates even if its title changes', () => {
  const response = { data: { catalogSectionsMap: { menu: [
    { payload: { standardItemsPayload: { catalogItems: [{ uuid: 'one', title: 'Coffee' }] } } },
    { payload: { standardItemsPayload: { title: { text: 'Drinks' }, catalogItems: [{ uuid: 'one', title: 'COFFEE' }] } } },
  ] } } };
  expect(parseStoreV1Response(response)!.items).toEqual([{ name: 'Coffee', sourceItemId: 'ubereats:one', section: 'Drinks' }]);
});

test('identical names without source IDs still deduplicate', () => {
  const response = { data: { catalogSectionsMap: { menu: [{ payload: { standardItemsPayload: {
    catalogItems: [{ title: 'Coffee' }, { title: 'COFFEE', uuid: ' ' }],
  } } }] } } };
  expect(parseStoreV1Response(response)!.items).toEqual([{ name: 'Coffee' }]);
});
