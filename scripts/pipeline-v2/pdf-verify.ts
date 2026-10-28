import type { Brand, ChainItem, MenuItem, Restaurant } from '@prisma/client';
import { z } from 'zod';
import { chainCatalogBatchSchema, type ChainCatalogBatch } from '../../apps/api/services/chainCatalogBatch';
import { buildChainMatcher, chainBindingFingerprint, chainMenuFingerprint } from '../../apps/api/services/chainCatalog';
import { aprilMenuIdentity, brandName, buildBrandIdentityMatcher } from '../../apps/api/services/chainServing';
import { planChainPilot, stateHash } from '../../apps/api/services/chainPilotPlan';
import { researchUrl } from '../../apps/api/services/pipelinePdfSource';
import { onDomain } from '../eval/pdf-finder/discover';
import { contents, documentOf, links } from '../eval/pdf-finder/html';
import { sha256, slugify, type Extraction } from '../eval/pdf-finder/types';

export interface PdfEvidence {
  sourceUrl: string; sourceBase64: string; pageUrl: string; pageBase64: string; fetchedAt: string;
}
export interface PdfMenu { restaurant: Restaurant; items: MenuItem[] }
export class PdfVerificationError extends Error {
  constructor(message: string) { super(message); this.name = 'PdfVerificationError'; }
}
const requireProof = (condition: unknown, message: string): void => { if (!condition) throw new PdfVerificationError(message); };

/** No fuzzy matching, inferred ownership, invented serving, or blanket national scope. */
export function verifyPdf(brand: Brand, brands: Brand[], catalog: ChainItem[], menus: PdfMenu[], evidence: PdfEvidence,
  extraction: Extraction, now = new Date()): ChainCatalogBatch {
  requireProof(brand.menuKind === 'restaurant' && ['high', 'llm-confirmed'].includes(brand.detectionConf ?? ''), 'Unverified chain');
  requireProof(brand.officialUrl, 'No established official brand URL');
  const domain = researchUrl(brand.officialUrl!).hostname.replace(/^www\./, '');
  for (const url of [evidence.sourceUrl, evidence.pageUrl]) requireProof(onDomain(researchUrl(url).href, domain), 'Source left official brand domain');
  const age = now.getTime() - Date.parse(evidence.fetchedAt);
  requireProof(Number.isFinite(age) && age >= 0 && age < 86_400_000, 'Official source snapshot is stale');
  const page = Buffer.from(evidence.pageBase64, 'base64').toString('utf8'), pageText = contents(documentOf(page));
  requireProof(links(page, evidence.pageUrl).some(link => link.url === evidence.sourceUrl && /nutri/i.test(link.title + link.url)), 'No current official nutrition link');
  const identityNames = [brand.displayName, ...brand.aliases].map(brandName).filter(Boolean);
  const hasBrand = (text: string) => identityNames.some(name => (` ${brandName(text)} `).includes(` ${name} `));
  const sourceBytes = Buffer.from(evidence.sourceBase64, 'base64');
  const sourceText = sourceBytes.subarray(0, 5).toString() === '%PDF-' ? extraction.text : contents(documentOf(sourceBytes.toString('utf8')));
  requireProof(hasBrand(pageText) && hasBrand(sourceText), 'Wrong or unconfirmed document brand');
  const region = `${pageText}\n${sourceText}`;
  requireProof(/\b(?:United States|U\.?S\.?A\.?|U\.S\.|California)\b/i.test(region), 'US/California applicability missing');
  requireProof(!/\b(?:Canada|Canadian|United Kingdom|Australia|Mexico|UK only|Hawaii only|New York only)\b/i.test(region), 'Conflicting regional menu');
  const revisions = [...region.matchAll(/\b(?:effective|updated|revised|as of|version)\b[^\n]{0,35}?\b(20\d{2})\b/gi)].map(match => Number(match[1]));
  requireProof(revisions.every(year => year >= now.getUTCFullYear() - 1 && year <= now.getUTCFullYear()), 'Outdated or future menu revision');
  const identity = buildBrandIdentityMatcher(brands);
  const current = menus.filter(menu => identity(menu.restaurant) === brand.id && menu.restaurant.lastScrapedAt
    && now.getTime() - menu.restaurant.lastScrapedAt.getTime() >= 0 && now.getTime() - menu.restaurant.lastScrapedAt.getTime() < 7 * 86_400_000
    && menu.restaurant.lat >= 33.95 && menu.restaurant.lat <= 34.15 && menu.restaurant.lng >= -118.50 && menu.restaurant.lng <= -118.15);
  requireProof(current.length, 'No recent LA location menu to corroborate the source');
  const existing = buildChainMatcher(catalog), changes: ChainCatalogBatch['changes'] = [];
  const sourceHash = sha256(Buffer.from(evidence.sourceBase64, 'base64'));
  const names = new Map<string, number>();
  extraction.items.forEach(item => names.set(brandName(item.name), (names.get(brandName(item.name)) ?? 0) + 1));
  for (const item of extraction.items) {
    // A duplicate name in another section/size is ambiguous until explicitly reviewed.
    if (names.get(brandName(item.name)) !== 1 || !item.section.trim() || !item.servingSize?.trim() || !Number.isInteger(item.calories)
      || item.notes.some(note => !/^Original HTML lines \d+-\d+\.$/.test(note))) continue;
    // Automatic aliases require the same source name/section and an explicit matching portion.
    // Missing portions or extra configuration need an explicitly reviewed binding, as in chainPilotData.
    const sourceAlias = { name: item.name, section: item.section, description: item.servingSize };
    const aliases = new Map<string, ReturnType<typeof aprilMenuIdentity>>();
    for (const menu of current) for (const menuItem of menu.items) {
      const alias = aprilMenuIdentity(menuItem);
      if (!menuItem.retiredAt && chainMenuFingerprint(sourceAlias) === chainMenuFingerprint(alias)
        && existing(brand.id, alias, menu.restaurant).status === 'unmatched') aliases.set(chainBindingFingerprint(alias), alias);
    }
    if (!aliases.size) continue;
    const canonicalKey = `pdf/${slugify(item.section || 'menu')}/${slugify(item.name)}`;
    if (catalog.some(row => row.brandId === brand.id && row.canonicalKey === canonicalKey)) continue;
    // Spot-check each accepted row against its retained source text before building an approval.
    requireProof(extraction.text.includes(item.rawText) && item.rawText.includes(item.name), 'Source row locator mismatch');
    for (const value of [item.calories, item.proteinG, item.carbsG, item.fatG]) {
      requireProof(Number.isFinite(value) && value >= 0 && new RegExp(`(?:^|[^\\d.])${String(value).replace('.', '\\.')}[^\\d.]|(?:^|[^\\d.])${String(value).replace('.', '\\.')}$`).test(item.rawText), 'Source row macro spot check failed');
    }
    changes.push({ slug: brand.slug, canonicalKey, expected: null,
      facts: { calories: item.calories, proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG, servingSize: item.servingSize },
      source: { url: evidence.sourceUrl, sha256: sourceHash },
      locator: `${item.page === null ? 'HTML' : `page ${item.page}`}, lines ${item.lineStart}-${item.lineEnd}: ${item.name}`,
      aliases: [...aliases.values()], usStates: ['CA'] });
  }
  requireProof(changes.length, 'No unambiguous current-menu nutrition rows passed verification');
  const batch = chainCatalogBatchSchema.parse({ version: 1, reviewedBy: 'pipeline-v2-pdf-v2 (source, region, serving, menu and row checks)', changes, quarantine: [] });
  try { planChainPilot(brands, catalog, batch); }
  catch { throw new PdfVerificationError('Catalog approval or alias validation failed'); }
  return batch;
}

const evidenceSchema = z.object({ sourceUrl: z.string(), sourceBase64: z.string(), pageUrl: z.string(), pageBase64: z.string(), fetchedAt: z.string() }).strict();
// Older packets approved names without serving equivalence and must never authorize a resumed write.
export const verifiedPdfSchema = z.object({ version: z.literal(2), brandId: z.string(), brandHash: z.string(),
  evidence: evidenceSchema, batch: chainCatalogBatchSchema, hash: z.string() }).strict();
export type VerifiedPdf = z.infer<typeof verifiedPdfSchema>;
export const pdfBrandHash = (brand: Brand) => stateHash([brand.id, brand.slug, brand.displayName, brand.aliases, brand.detectionConf, brand.menuKind, brand.officialUrl]);
export function sealPdf(brand: Brand, evidence: PdfEvidence, batch: ChainCatalogBatch): VerifiedPdf {
  const value = { version: 2 as const, brandId: brand.id, brandHash: pdfBrandHash(brand), evidence, batch };
  return { ...value, hash: stateHash(value) };
}
export function readVerifiedPdf(input: unknown, brand: Brand): VerifiedPdf {
  const parsed = verifiedPdfSchema.safeParse(input);
  if (!parsed.success) throw new PdfVerificationError('Saved verification protocol is obsolete or invalid');
  const packet = parsed.data, { hash, ...value } = packet;
  requireProof(packet.brandId === brand.id && packet.brandHash === pdfBrandHash(brand) && hash === stateHash(value), 'Saved verification identity changed');
  requireProof(packet.batch.quarantine.length === 0 && packet.batch.changes.every(change => change.slug === brand.slug && change.expected === null
    && change.source.sha256 === sha256(Buffer.from(packet.evidence.sourceBase64, 'base64'))), 'Saved verification is not additive source-bound data');
  return packet;
}

