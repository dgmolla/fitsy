/** Synthetic, task-owned dev menus for the chain-quality simulator scenario. */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { compileChainProductBatch } from '../../apps/api/services/chainProductBatch';
import { applyCatalogPlan, planChainPilot } from '../../apps/api/services/chainPilotPlan';
import { loadChainServing, resolveChainMacros, applyAprilChainMatch, aprilMenuIdentity } from '../../apps/api/services/chainServing';
import { parseStoreV1Response } from '../../apps/api/services/menuSources/ueApiClient';
import { persistHex } from '../hex-persist';
import { validateHexInTx } from '../preload-invariants';

const scope = 'e2e-chain-quality-';
const url = process.env['POSTGRES_PRISMA_URL'];
if (!url || url.includes('zaxkmjqozvmbifiwbxps')) throw new Error('Load the dev environment; production is forbidden');
const command = process.argv[2];
if (!['seed', 'clean'].includes(command ?? '')) throw new Error('Use seed or clean');
if (command === 'seed' && !process.argv[3]) throw new Error('Pass the captured WaBa UE fixture JSON path');
const p = new PrismaClient();
const estimate = { calories: 400, proteinG: 20, carbsG: 50, fatG: 13, confidence: 'MEDIUM' as const, source: 'haiku', dietaryTags: [] };
async function clean() {
  await p.restaurant.deleteMany({ where: { id: { startsWith: scope }, storeUuid: { startsWith: scope }, source: scope } });
  const brands = await p.brand.findMany({ where: { slug: { in: [scope + 'waba-grill', scope + 'yoshinoya'] } } });
  await p.chainItem.deleteMany({ where: { brandId: { in: brands.map(b => b.id) } } });
  await p.brand.deleteMany({ where: { id: { in: brands.map(b => b.id) } } });
  await p.pipelineCompletedHex.deleteMany({ where: { runId: scope } });
}
async function seed() {
  const input = JSON.parse(readFileSync('apps/api/services/chainCatalogs/chain-quality-2026-09-input.json', 'utf8'));
  const batch = compileChainProductBatch(input);
  for (const change of batch.changes) { change.slug = scope + change.slug; change.expected = null; }
  const brands = await Promise.all(['waba-grill', 'yoshinoya'].map(slug => p.brand.create({ data: {
    slug: scope + slug, displayName: slug === 'waba-grill' ? 'Chain Quality WaBa' : 'Chain Quality Yoshinoya', detectionConf: 'high',
  } })));
  await applyCatalogPlan(p, planChainPilot(brands, [], batch), batch);
  const runtime = await loadChainServing(p), brand = brands[0]!;
  const captured = parseStoreV1Response(JSON.parse(readFileSync(process.argv[3]!, 'utf8')))!.items;
  const items = ['Chicken Bowl', 'Pepsi - 20oz Bottle'].map(name => {
    const item = captured.find(i => i.name === name); if (!item) throw new Error('Captured item missing: ' + name); return item;
  });
  for (const writer of ['april', 'ue']) {
    const id = scope + writer;
    await p.restaurant.create({ data: { id, storeUuid: id, name: brand.displayName + ' (' + writer + ')', source: scope,
      brandId: brand.id, address: 'Isolated dev fixture', lat: 0, lng: 0, cuisineTags: [] } });
    if (writer === 'ue') {
      const macros = await resolveChainMacros(items, brand.id, runtime.match, async unresolved => unresolved.map(() => estimate));
      await persistHex(scope, writer, [{ restaurantId: id, brandId: brand.id, menuHash: 'quality-fixture',
        items: items.map((item, i) => ({ item, macro: macros[i]! })) }], p, { validateInTx: validateHexInTx });
    } else for (const item of items) {
      const { calories, proteinG, carbsG, fatG } = estimate;
      const before = await p.menuItem.create({ data: { restaurantId: id, name: item.name, section: item.section, description: item.description,
        calories, proteinG, carbsG, fatG, macroEstimates: { create: { calories, proteinG, carbsG, fatG, confidence: 'MEDIUM', source: 'haiku' } } },
        include: { macroEstimates: { orderBy: { id: 'asc' } } } });
      const match = runtime.match(brand.id, aprilMenuIdentity(before));
      if (match.status !== 'matched') throw new Error('Expected fixture match: ' + item.name);
      await applyAprilChainMatch(p, before, match.row);
    }
  }
  const rows = await p.menuItem.findMany({ where: { restaurantId: { in: [scope + 'april', scope + 'ue'] } }, select: { restaurantId: true, name: true, calories: true, proteinG: true, carbsG: true, fatG: true } });
  process.stdout.write(JSON.stringify({ fixture: scope, rows }) + '\n');
}
async function main() {
  try { await clean(); if (command === 'seed') await seed(); }
  catch (error) { await clean(); throw error; } finally { await p.$disconnect(); }
}
void main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
