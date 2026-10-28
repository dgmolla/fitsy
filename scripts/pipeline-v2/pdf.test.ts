import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Brand, ChainItem, MenuItem, Restaurant } from '@prisma/client';
import { parseHtml } from '../eval/pdf-finder/parse';
import { parsePdfOptions } from './pdf-worker';
import { pdfRetryMs } from './pdf-queue';
import { verifyPdf, sealPdf, readVerifiedPdf, type PdfEvidence, type PdfMenu } from './pdf-verify';
import { planChainPilot } from '../../apps/api/services/chainPilotPlan';
import { publicResearchAddress, researchUrl } from '../../apps/api/services/pipelinePdfSource';

const now = new Date('2026-10-28T12:00:00Z');
const brand: Brand = { id: 'pdf-brand', slug: 'novel-chain', displayName: 'Novel Chain', aliases: [], detectionConf: 'high', menuKind: 'restaurant',
  locationCount: 4, bestPair: null, distinctive: true, macroSource: null, officialUrl: 'https://novelchain.com/nutrition', createdAt: now, updatedAt: now };
const table = readFileSync(resolve(__dirname, '../eval/pdf-finder/fixtures/table.html'), 'utf8');
const html = `<html><h1>Novel Chain nutrition, United States, updated October 2026</h1>${table}</html>`;
const extraction = () => parseHtml(html);
const evidence = (): PdfEvidence => ({ sourceUrl: 'https://novelchain.com/nutrition.html', sourceBase64: Buffer.from(html).toString('base64'),
  pageUrl: 'https://novelchain.com/nutrition', fetchedAt: now.toISOString(), pageBase64: Buffer.from('<h1>Novel Chain United States</h1><a href="/nutrition.html">Current nutrition</a>').toString('base64') });
const restaurant = { id: 'pdf-location', name: 'Novel Chain', brandId: brand.id, lat: 34.05, lng: -118.25,
  lastScrapedAt: now } as Restaurant;
const menus = (): PdfMenu[] => [{ restaurant, items: [{ id: 'dish-1', restaurantId: restaurant.id, name: 'Rice & Chicken', section: 'Lunch',
  description: null, sourceItemId: 'ubereats:chicken', retiredAt: null } as MenuItem] }];
const verify = (proof = evidence(), parsed = extraction(), locations = menus(), catalog: ChainItem[] = [], b = brand) => verifyPdf(b, [b], catalog, locations, proof, parsed, now);

test('partial nutrition sources approve only exact current-menu rows, with explicit California scope and source proof', () => {
  const batch = verify();
  expect(batch.changes).toHaveLength(1);
  expect(batch.changes[0]).toMatchObject({ expected: null, facts: { calories: 410, proteinG: 35, carbsG: 45, fatG: 10, servingSize: '250 g' },
    aliases: [{ name: 'Rice & Chicken', section: 'Lunch', sourceItemId: 'ubereats:chicken' }], usStates: ['CA'] });
  expect(planChainPilot([brand], [], batch).changes).toHaveLength(1);
});

test.each([
  ['off-domain document', () => ({ ...evidence(), sourceUrl: 'https://unrelated.com/nutrition.html' })],
  ['current official link missing', () => ({ ...evidence(), pageBase64: Buffer.from('<h1>Novel Chain United States</h1>').toString('base64') })],
  ['stale snapshot', () => ({ ...evidence(), fetchedAt: '2026-10-25T00:00:00Z' })],
  ['future snapshot', () => ({ ...evidence(), fetchedAt: '2026-10-29T00:00:00Z' })],
  ['wrong brand', () => ({ ...evidence(), sourceBase64: Buffer.from(html.replace('Novel Chain', 'Another Brand')).toString('base64') })],
  ['wrong region', () => ({ ...evidence(), sourceBase64: Buffer.from(html.replace('United States', 'Canada')).toString('base64') })],
  ['old menu revision', () => ({ ...evidence(), sourceBase64: Buffer.from(html.replace('2026', '2021')).toString('base64') })],
])('verification rejects %s before a catalog plan exists', (_reason, proof) => { expect(() => verify(proof())).toThrow(); });

test('unknown brands, missing official ownership, stale menus, retired dishes and conflicting brand bindings fail closed', () => {
  expect(() => verify(evidence(), extraction(), menus(), [], { ...brand, detectionConf: 'review' })).toThrow('Unverified chain');
  expect(() => verify(evidence(), extraction(), menus(), [], { ...brand, officialUrl: null })).toThrow('established official');
  expect(() => verify(evidence(), extraction(), [{ restaurant: { ...restaurant, lastScrapedAt: new Date('2026-01-01') }, items: menus()[0]!.items }])).toThrow('recent LA');
  expect(() => verify(evidence(), extraction(), [{ restaurant: { ...restaurant, brandId: 'another-brand' }, items: menus()[0]!.items }])).toThrow('recent LA');
  const retired = menus(); retired[0]!.items[0]!.retiredAt = now;
  expect(() => verify(evidence(), extraction(), retired)).toThrow('No unambiguous');
});

test('missing serving, ambiguous duplicate names, numeric spot-check failures and implausible energy never become approvals', () => {
  const missing = extraction(); missing.items[0]!.servingSize = null;
  expect(() => verify(evidence(), missing)).toThrow('No unambiguous');
  const duplicate = extraction(); duplicate.items.push({ ...duplicate.items[0]!, section: 'Dinner' });
  expect(() => verify(evidence(), duplicate)).toThrow('No unambiguous');
  const altered = extraction(); altered.items[0]!.proteinG = 999;
  expect(() => verify(evidence(), altered)).toThrow('spot check');
  const badEnergy = extraction(); badEnergy.items[0]!.fatG = 45;
  expect(() => verify(evidence(), badEnergy)).toThrow('approval');
});

test('reviewed catalog facts are preserved and sealed recovery data rejects identity or content drift', () => {
  const batch = verify(), plan = planChainPilot([brand], [], batch);
  const catalog = plan.changes.map(change => ({ ...change.desired, id: 'curated', createdAt: now, updatedAt: now, retrievedAt: now })) as ChainItem[];
  expect(() => verify(evidence(), extraction(), menus(), catalog)).toThrow('No unambiguous');
  const packet = sealPdf(brand, evidence(), batch);
  expect(readVerifiedPdf(JSON.parse(JSON.stringify(packet)), brand)).toEqual(packet);
  expect(() => readVerifiedPdf({ ...packet, batch: { ...batch, reviewedBy: 'tampered' } }, brand)).toThrow('identity changed');
  expect(() => readVerifiedPdf(packet, { ...brand, officialUrl: 'https://different.com' })).toThrow('identity changed');
});

test('PDF command bounds and chain-wide backoff cannot be overridden by a worker', () => {
  expect(parsePdfOptions(['pdf-enqueue', '--brand-id=brand-a', '--brand-id=brand-a']).brandIds).toEqual(['brand-a']);
  expect(parsePdfOptions(['pdf-worker', '--worker-id=a', '--out=private']).maxJobs).toBe(1);
  expect([1, 2, 3, 10].map(pdfRetryMs)).toEqual([3_600_000, 7_200_000, 14_400_000, 86_400_000]);
  for (const args of [['pdf-enqueue'], ['pdf-worker'], ['pdf-worker', '--worker-id=a', '--out=private', '--max-jobs=1001'],
    ['pdf-worker', '--worker-id=a', '--out=private', '--brand-id=b'], ['pdf-enqueue', '--brand-id=a', '--out=private'],
    ['pdf-worker', '--worker-id=a', '--worker-id=b', '--out=private']]) expect(() => parsePdfOptions(args)).toThrow();
});

test('supported npm entrypoints route to PDF argument validation before opening any database or provider', () => {
  for (const command of ['preload:v2:pdf-enqueue', 'preload:v2:pdf-worker']) {
    const result = spawnSync('npm', ['run', command], { cwd: resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    expect(result.status).toBe(1); expect(result.stderr).toContain(command.endsWith('enqueue') ? 'PDF enqueue requires' : 'PDF worker requires');
  }
});

test('research URL and address guards refuse credentials, internal services and private address families', () => {
  expect(researchUrl('https://novelchain.com/nutrition#top').href).toBe('https://novelchain.com/nutrition');
  for (const url of ['http://chain.com', 'https://a:b@chain.com', 'https://127.0.0.1', 'https://metadata.internal', 'https://chain.com:3000']) expect(() => researchUrl(url)).toThrow();
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(publicResearchAddress(address)).toBe(false);
  expect(publicResearchAddress('8.8.8.8')).toBe(true); expect(publicResearchAddress('2606:4700::1111')).toBe(true);
});
