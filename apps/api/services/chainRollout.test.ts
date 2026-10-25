import capture from '../tests/fixtures/menu-source-identity.json';
import { parseStoreV1Response } from './menuSources/ueApiClient';
import { chainCatalogBatchSchema } from './chainCatalogBatch';
import { compileChainProductBatch } from './chainProductBatch';
import { planChainPilot } from './chainPilotPlan';
import { buildChainMatcher } from './chainCatalog';
import { aprilMenuIdentity, officialMacro, resolveChainMacros } from './chainServing';
import { validateItems } from '../../../scripts/pipeline-utils';

test('captured same-title products retain separate reviewed servings through compilation, existing menus and UE imports', async () => {
  const items = parseStoreV1Response(capture)!.items;
  expect(items).toHaveLength(2);
  const now = new Date();
  const brand = { id: 'synthetic', slug: 'synthetic', displayName: 'Synthetic fixture', aliases: [], menuKind: 'restaurant',
    detectionConf: 'high', locationCount: 1, bestPair: null, distinctive: false, macroSource: null,
    officialUrl: null, createdAt: now, updatedAt: now };
  // Synthetic nutrition proves plumbing only, and must never be used as a real Panini approval.
  const batch = chainCatalogBatchSchema.parse({ version: 1, reviewedBy: 'Synthetic regression only', quarantine: [],
    changes: items.map((item, i) => ({ slug: brand.slug, canonicalKey: `fixture-${i}`, expected: null,
      facts: { calories: i ? 1640 : 410, proteinG: i ? 80 : 20, carbsG: i ? 200 : 50, fatG: i ? 40 : 10,
        servingSize: i ? 'Synthetic family serving' : 'Synthetic individual serving' },
      aliases: [{ name: item.name, sourceItemId: item.sourceItemId, section: item.section, description: item.description }],
      source: { url: 'https://example.com/synthetic-label', sha256: 'a'.repeat(64) }, locator: 'Synthetic fixture, not food facts' })) });
  const plan = planChainPilot([brand], [], batch);
  const rows = plan.changes.map(c => ({ ...c.desired, id: `fixture:${c.desired.canonicalKey}` }));
  const matcher = buildChainMatcher(rows);
  const fallback = jest.fn();
  const macros = await resolveChainMacros(items, brand.id, matcher, fallback);
  expect(fallback).not.toHaveBeenCalled();
  expect(macros.map(m => [m!.calories, m!.carbsG, m!.source])).toEqual([[410, 50, 'official'], [1640, 200, 'official']]);
  for (const [i, item] of items.entries()) {
    const persisted = { id: `menu:${i}`, restaurantId: 'fixture', updatedAt: now, name: item.name,
      sourceItemId: item.sourceItemId!, section: item.section ?? null, description: item.description ?? null };
    const match = matcher(brand.id, aprilMenuIdentity(persisted));
    expect(match.status).toBe('matched');
    if (match.status === 'matched') expect(officialMacro(match.row, aprilMenuIdentity(persisted))).toEqual(macros[i]);
  }
});

test('manufacturer allulose evidence survives product bindings and planning, without changing total carbs', () => {
  const now = new Date();
  const brand = { id: 'fixture', slug: 'fixture', displayName: 'Fixture', aliases: [], menuKind: 'restaurant', detectionConf: 'high',
    locationCount: 1, bestPair: null, distinctive: false, macroSource: null, officialUrl: null, createdAt: now, updatedAt: now };
  const batch = compileChainProductBatch({ version: 1, reviewedBy: 'Synthetic regression', changes: [], quarantine: [],
    products: [{ key: 'fixture', market: 'US', name: 'Synthetic label',
      facts: { calories: 12, proteinG: 0, carbsG: 30, fatG: 0, servingSize: '1 synthetic serving' },
      allulose: { grams: 30, locator: 'Synthetic label allulose line' },
      source: { url: 'https://example.com/synthetic', sha256: 'a'.repeat(64) }, locator: 'Synthetic label' }],
    bindings: [{ productKey: 'fixture', slug: 'fixture', canonicalKey: 'fixture', expected: null,
      aliases: [{ name: 'Synthetic label', sourceItemId: 'ubereats:fixture' }] }] });
  const plan = planChainPilot([brand], [], batch);
  const match = buildChainMatcher(plan.changes.map(c => ({ ...c.desired, id: 'fixture' })))('fixture', { name: 'Synthetic label', sourceItemId: 'ubereats:fixture' });
  expect(match).toMatchObject({ status: 'matched', row: { carbsG: 30, calories: 12, review: { allulose: { grams: 30 } } } });
  if (match.status === 'matched') {
    const item = { name: 'Synthetic label', sourceItemId: 'ubereats:fixture' };
    const macro = officialMacro(match.row, item);
    expect(JSON.parse(macro.reasoning)).toMatchObject({ allulose: { grams: 30, locator: 'Synthetic label allulose line' } });
    expect(validateItems([item], [macro])).toMatchObject({ valid: [{ macro: { calories: 12, carbsG: 30 } }], macroMismatches: [] });
  }
});
