import { spawnSync } from 'node:child_process';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
import * as dns from 'node:dns/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Brand, ChainItem, MenuItem, Restaurant } from '@prisma/client';
import { parseHtml } from '../eval/pdf-finder/parse';
import { parsePdfOptions, researchPdf } from './pdf-worker';
import { pdfRetryMs } from './pdf-queue';
import { verifyPdf, sealPdf, readVerifiedPdf, type PdfEvidence, type PdfMenu } from './pdf-verify';
import { planChainPilot, stateHash } from '../../apps/api/services/chainPilotPlan';
import { buildChainMatcher } from '../../apps/api/services/chainCatalog';
import { aprilMenuIdentity, resolveChainMacros } from '../../apps/api/services/chainServing';
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
  description: '250 g', sourceItemId: 'ubereats:chicken', retiredAt: null } as MenuItem] }];
const verify = (proof = evidence(), parsed = extraction(), locations = menus(), catalog: ChainItem[] = [], b = brand) => verifyPdf(b, [b], catalog, locations, proof, parsed, now);

test('partial nutrition sources approve only exact current-menu rows, with explicit California scope and source proof', () => {
  const batch = verify();
  expect(batch.changes).toHaveLength(1);
  expect(batch.changes[0]).toMatchObject({ expected: null, facts: { calories: 410, proteinG: 35, carbsG: 45, fatG: 10, servingSize: '250 g' },
    aliases: [{ name: 'Rice & Chicken', section: 'Lunch', description: '250 g', sourceItemId: 'ubereats:chicken' }], usStates: ['CA'] });
  expect(planChainPilot([brand], [], batch).changes).toHaveLength(1);
});

test('the source-to-serving path keeps differently sized and configured meals on Jev', async () => {
  const locations = menus(), standard = { ...locations[0]!.items[0]!, description: '250 g' };
  const family = { ...standard, id: 'family', sourceItemId: 'ubereats:family', section: 'Family Meals', description: '1000 g; serves four' };
  const extra = { ...standard, id: 'extra', sourceItemId: 'ubereats:extra', description: '250 g with extra chicken' };
  const unknown = { ...standard, id: 'unknown', sourceItemId: 'ubereats:unknown', description: null };
  locations[0]!.items = [standard, family, extra, unknown];
  const batch = verify(evidence(), extraction(), locations);
  const catalog = planChainPilot([brand], [], batch).changes.map(change => ({ ...change.desired, id: change.desired.canonicalKey }));
  const estimates = [family, extra, unknown].map(() => ({ calories: 1640, proteinG: 140, carbsG: 180, fatG: 40,
    confidence: 'MEDIUM' as const, source: 'jev', dietaryTags: [] }));
  const unresolved: string[] = [];
  const served = await resolveChainMacros(locations[0]!.items.map(aprilMenuIdentity), brand.id, buildChainMatcher(catalog), async items => {
    unresolved.push(...items.map(item => item.sourceItemId!));
    return estimates.slice(0, items.length);
  }, restaurant);
  expect(served[0]).toMatchObject({ calories: 410, source: 'official', confidence: 'HIGH' });
  expect(served.slice(1)).toEqual(estimates);
  expect(unresolved).toEqual(['ubereats:family', 'ubereats:extra', 'ubereats:unknown']);
  expect(batch.changes[0]!.aliases).toEqual([aprilMenuIdentity(standard)]);
});

test.each([
  ['same-domain redirects', 'https://novelchain.com/', 'https://novelchain.com/nutrition.html', true],
  ['off-domain homepage redirects', 'https://unrelated.com/', 'https://novelchain.com/nutrition.html', false],
  ['off-domain document redirects', 'https://novelchain.com/', 'https://unrelated.com/nutrition.html', false],
])('research retains official links after %s without granting new domain authority', async (_scenario, pageUrl, sourceUrl, accepted) => {
  const out = mkdtempSync(join(tmpdir(), 'fitsy-pdf-research-'));
  const researchedAt = new Date(), sourceHtml = html.replace('2026', String(researchedAt.getUTCFullYear()));
  const requested: string[] = [];
  const allAddresses: { lookup(hostname: string, options: LookupAllOptions): Promise<LookupAddress[]> } = dns;
  const lookup = jest.spyOn(allAddresses, 'lookup');
  lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  const http = jest.spyOn(global, 'fetch').mockImplementation(async input => {
    const url = String(input); requested.push(url);
    if (/^https:\/\/(?:html|lite)\.duckduckgo\.com\/|^https:\/\/www\.bing\.com\//.test(url)) return new Response('<html>No results</html>');
    if (url === 'https://www.novelchain.com/') return new Response(null, { status: 301, headers: { location: pageUrl } });
    if (url === pageUrl) return new Response(Buffer.from(evidence().pageBase64, 'base64').toString());
    if (url === evidence().sourceUrl && sourceUrl !== url) return new Response(null, { status: 302, headers: { location: sourceUrl } });
    if (url === sourceUrl) return new Response(sourceHtml);
    throw new Error(`Unexpected fixture request: ${url}`);
  });
  try {
    if (!accepted) {
      await expect(researchPdf(brand, out, new AbortController().signal)).rejects.toThrow('No current official nutrition document');
      expect(requested).toContain(pageUrl === 'https://novelchain.com/' ? sourceUrl : pageUrl);
      return;
    }
    const result = await researchPdf(brand, out, new AbortController().signal);
    expect(result.evidence).toMatchObject({ pageUrl: 'https://novelchain.com/', sourceUrl: evidence().sourceUrl });
    const locations = menus(); locations[0]!.restaurant = { ...restaurant, lastScrapedAt: researchedAt };
    expect(verifyPdf(brand, [brand], [], locations, result.evidence, result.extraction).changes).toHaveLength(1);
    expect(requested.filter(url => url === 'https://www.novelchain.com/')).toHaveLength(1);
    expect(requested).toContain(evidence().sourceUrl);
  } finally { http.mockRestore(); lookup.mockRestore(); rmSync(out, { recursive: true, force: true }); }
});

test.each([
  { section: 'Family Meals', description: '250 g' },
  { section: 'Lunch', description: '1000 g; serves four' },
  { section: 'Lunch', description: '250 g with extra chicken' },
  { section: 'Lunch', description: null },
  { section: 'Lunch', description: '' },
  { section: null, description: '250 g' },
  { name: 'Rice Chicken', section: 'Lunch', description: '250 g' },
])('unproven serving or configuration cannot produce any write approval: %j', context => {
  const locations = menus(); Object.assign(locations[0]!.items[0]!, context);
  expect(() => verify(evidence(), extraction(), locations)).toThrow('No unambiguous');
});

test('case and whitespace preserve an explicit source-backed serving', () => {
  const locations = menus();
  Object.assign(locations[0]!.items[0]!, { name: ' RICE &  CHICKEN ', section: ' LUNCH ', description: ' 250   G ' });
  expect(verify(evidence(), extraction(), locations).changes).toHaveLength(1);
});

test('one source retains the explicit provider binding for each corroborated chain location', () => {
  const locations = menus(), other = { ...restaurant, id: 'pdf-location-2' };
  locations.push({ restaurant: other, items: [{ ...locations[0]!.items[0]!, id: 'dish-2', restaurantId: other.id, sourceItemId: 'ubereats:other-location' }] });
  const batch = verify(evidence(), extraction(), locations);
  const catalog = planChainPilot([brand], [], batch).changes.map(change => ({ ...change.desired, id: change.desired.canonicalKey }));
  const match = buildChainMatcher(catalog);
  for (const menu of locations) expect(match(brand.id, aprilMenuIdentity(menu.items[0]!), menu.restaurant).status).toBe('matched');
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
  const legacy = { version: 1, brandId: packet.brandId, brandHash: packet.brandHash, evidence: packet.evidence, batch: packet.batch };
  expect(() => readVerifiedPdf({ ...legacy, hash: stateHash(legacy) }, brand)).toThrow('protocol is obsolete or invalid');
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
  const loopback = '127.0.0.1'; // loopback test fixture
  const privateIpv4 = [
    [10, 0, 0, 1], [172, 16, 0, 1], [192, 168, 1, 1],
  ].map(octets => octets.join('.'));
  expect(researchUrl('https://novelchain.com/nutrition#top').href).toBe('https://novelchain.com/nutrition');
  for (const url of ['http://chain.com', 'https://a:b@chain.com', `https://${loopback}`, 'https://metadata.internal', 'https://chain.com:3000']) expect(() => researchUrl(url)).toThrow();
  for (const address of [loopback, ...privateIpv4, '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', `::ffff:${loopback}`]) expect(publicResearchAddress(address)).toBe(false);
  expect(publicResearchAddress('8.8.8.8')).toBe(true); expect(publicResearchAddress('2606:4700::1111')).toBe(true);
});
