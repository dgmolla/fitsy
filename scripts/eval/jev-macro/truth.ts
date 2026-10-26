import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { chainBatchTruth, chainBindingTruth } from '../../../apps/api/tests/fixtures/chain-batch-truth';
import { chainQualityTruth } from '../../../apps/api/tests/fixtures/chain-quality-truth';

export const repository = resolve(__dirname, '../../..');
export const truthPath = 'scripts/eval/jev-macro/truth.json';
export const sourcePaths = {
  catalog: 'apps/api/services/chainCatalogs/waba-yoshinoya-2026-09.json',
  extraction: 'apps/api/tests/fixtures/__snapshots__/chain-batch-source-extraction.json',
  bindings: 'apps/api/tests/fixtures/chain-batch-truth.ts',
  observations: 'apps/api/tests/fixtures/__snapshots__/chain-batch-observations.json',
  products: 'apps/api/services/chainCatalogs/chain-quality-2026-09-input.json',
  productTruth: 'apps/api/tests/fixtures/chain-quality-truth.ts',
  historicalBaseline: 'scripts/eval/results/20260405-000337-haiku-baseline.json',
  historicalHints: 'scripts/eval/results/20260405-000551-haiku-chain-hints.json',
  historicalServing: 'scripts/eval/results/20260405-000601-haiku-serving.json',
  catastrophicDefinition: 'scripts/eval/hero-eval/run.ts',
  zeroDefinition: 'scripts/eval/lib/metrics.ts',
  pricing: 'docs/engineering/pipeline/jev-chain-match-eval.md',
} as const;
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const text = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const value = z.number().finite().nonnegative();
const aliasSchema = z.object({ name: text, section: z.string(), description: z.string() });
const factsSchema = z.object({ calories: value, proteinG: value, carbsG: value, fatG: value, servingSize: text });
const publishedSource = z.object({ url: z.url(), sha256: hash });
const definitionSchema = z.object({ slug: z.enum(['waba-grill', 'yoshinoya']), canonicalKey: text,
  facts: factsSchema, source: publishedSource, locator: text, aliases: z.array(aliasSchema) });
const extractionSchema = z.object({ brand: z.enum(['waba', 'yoshinoya']), canonicalKey: text,
  page: z.number().int().positive(), section: text, name: text, serving: value.nullable(),
  calories: value, proteinG: value, carbsG: value, fatG: value, factStatus: z.enum(['accepted', 'held']), reason: z.string() });
const rowSchema = z.object({
  id: text, chain: z.enum(['WaBa Grill', 'Yoshinoya']), itemName: text, section: z.string(), description: z.string(), serving: text,
  calories: value, protein_g: value, carbs_g: value, fat_g: value,
  source: z.object({ file: text, provenance: z.enum(['official-pdf', 'official-manufacturer-label']),
    url: z.url(), publishedSha256: hash, locator: text, reviewedBy: text,
    extractionFile: text.nullable(), bindingFile: text.nullable() }).strict(),
}).strict();
export const truthSchema = z.object({
  version: z.literal(1), generatedBy: text, selection: text,
  sources: z.array(z.object({ file: text, sha256: hash }).strict()),
  exclusions: z.array(z.object({ id: text, reason: text }).strict()),
  rows: z.array(rowSchema).min(100).max(200),
}).strict();
export type TruthRow = z.infer<typeof rowSchema>;
export type Truth = z.infer<typeof truthSchema>;
const chainName = (slug: string) => slug === 'waba-grill' ? 'WaBa Grill' as const : 'Yoshinoya' as const;
const idOf = (slug: string, key: string) => `${slug}:${key}`;
const aliasKey = (alias: z.infer<typeof aliasSchema>) => JSON.stringify([alias.name, alias.section, alias.description]);
const readJson = (root: string, file: string): unknown => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const nutritionQuantity = /\b\d+(?:\.\d+)?[ \t]*(?:kcal|calories?|g(?:rams?)?[ \t]+(?:of[ \t]+)?(?:protein|carb(?:ohydrate)?s?|fat|sugar|fiber))\b/i;
// Remove complete nutrition-bearing marketing sentences rather than hinting at their target values.
const descriptionOnly = (description: string) => description.split(/(?<=[.!?])\s+/)
  .filter(sentence => !nutritionQuantity.test(sentence)).join(' ');

/** Explicit local-file allowlist only: no env loader, database, scraping or model imports. */
export function buildTruth(root = repository): Truth {
  const catalog = z.object({ reviewedBy: text, changes: z.array(definitionSchema) }).parse(readJson(root, sourcePaths.catalog));
  const extraction = z.array(extractionSchema).parse(readJson(root, sourcePaths.extraction));
  const observations = z.array(aliasSchema.extend({ slug: text })).parse(readJson(root, sourcePaths.observations));
  const products = z.object({ reviewedBy: text,
    products: z.array(z.object({ key: text, facts: factsSchema, source: publishedSource, locator: text })),
    bindings: z.array(z.object({ slug: text, canonicalKey: text, productKey: text, aliases: z.array(aliasSchema).min(1) })),
  }).parse(readJson(root, sourcePaths.products));
  const definitions = new Map(catalog.changes.map(row => [idOf(row.slug, row.canonicalKey), row]));
  const independent = new Map(chainBatchTruth.map(([slug, key, ...macros]) => [idOf(slug, key), macros]));
  const rows: TruthRow[] = [];
  const exclusions: Truth['exclusions'] = extraction.filter(row => row.factStatus === 'held')
    .map(row => ({ id: idOf(row.brand === 'waba' ? 'waba-grill' : row.brand, row.canonicalKey), reason: row.reason }));
  for (const row of extraction.filter(row => row.factStatus === 'accepted')) {
    const slug = row.brand === 'waba' ? 'waba-grill' : row.brand;
    const id = idOf(slug, row.canonicalKey), definition = definitions.get(id);
    if (!definition || [Math.round(row.calories), row.proteinG, row.carbsG, row.fatG].some((n, i) =>
      n !== [definition.facts.calories, definition.facts.proteinG, definition.facts.carbsG, definition.facts.fatG][i])) {
      throw new Error(`Published extraction/catalog disagreement: ${id}`);
    }
    const transcribed = independent.get(id);
    if (transcribed && transcribed.some((n, i) => n !== [Math.round(row.calories), row.proteinG, row.carbsG, row.fatG][i])) {
      throw new Error(`Independent transcription disagreement: ${id}`);
    }
    // One contextual LA variant per published serving. Never multiply sample size by alias count.
    const aliases = chainBindingTruth.filter(([brand, key]) => idOf(brand, key) === id).map(([, , alias]) => alias)
      .sort((a, b) => b.description.length - a.description.length || compare(aliasKey(a), aliasKey(b)));
    const alias = aliases[0];
    if (alias && (!definition.aliases.some(a => aliasKey(a) === aliasKey(alias))
      || !observations.some(a => a.slug === slug && aliasKey(a) === aliasKey(alias)))) {
      throw new Error(`Unverified LA menu binding: ${id}`);
    }
    rows.push({ id, chain: chainName(slug), itemName: alias?.name ?? row.name,
      section: alias?.section ?? row.section, description: descriptionOnly(alias?.description ?? ''),
      serving: `${definition.facts.servingSize.replace(/\bprotein side\b/gi, 'side')}${row.serving === null ? '' : `; published mass ${row.serving} g`}`,
      calories: row.calories, protein_g: row.proteinG, carbs_g: row.carbsG, fat_g: row.fatG,
      source: { file: sourcePaths.catalog, provenance: 'official-pdf', url: definition.source.url,
        publishedSha256: definition.source.sha256, locator: definition.locator, reviewedBy: catalog.reviewedBy,
        extractionFile: sourcePaths.extraction, bindingFile: alias ? sourcePaths.bindings : null } });
  }
  for (const binding of products.bindings) {
    const product = products.products.find(p => p.key === binding.productKey);
    const alias = [...binding.aliases].sort((a, b) => compare(aliasKey(a), aliasKey(b)))[0]!;
    const checked = chainQualityTruth.find(([slug, name]) => slug === binding.slug && name === alias.name);
    if (!product || !checked || checked.slice(2).some((n, i) =>
      n !== [product.facts.calories, product.facts.proteinG, product.facts.carbsG, product.facts.fatG][i])) {
      throw new Error('Manufacturer label lacks independent transcription');
    }
    rows.push({ id: idOf(binding.slug, binding.canonicalKey), chain: chainName(binding.slug), itemName: alias.name,
      section: alias.section, description: descriptionOnly(alias.description), serving: product.facts.servingSize,
      calories: product.facts.calories, protein_g: product.facts.proteinG, carbs_g: product.facts.carbsG, fat_g: product.facts.fatG,
      source: { file: sourcePaths.products, provenance: 'official-manufacturer-label', url: product.source.url,
        publishedSha256: product.source.sha256, locator: product.locator, reviewedBy: products.reviewedBy,
        extractionFile: sourcePaths.productTruth, bindingFile: sourcePaths.products } });
  }
  const included = new Set(rows.map(row => row.id));
  for (const definition of catalog.changes.filter(d => !included.has(idOf(d.slug, d.canonicalKey)))) {
    exclusions.push({ id: idOf(definition.slug, definition.canonicalKey), reason: 'Derived serving absent from the direct published extraction (two-cookie multiplication); do not duplicate the published one-cookie row.' });
  }
  if (included.size !== rows.length) throw new Error('Duplicate published serving');
  return truthSchema.parse({ version: 1, generatedBy: 'npm run eval:jev-macro:truth -w scripts',
    selection: 'All accepted direct PDF rows, then all nine independently transcribed LA manufacturer labels; one row per chain and canonical serving; ASCII id order; original published decimals; no sampling or FatSecret.',
    sources: Object.values(sourcePaths).map(file => ({ file, sha256: sha256(readFileSync(resolve(root, file))) })),
    exclusions: exclusions.sort((a, b) => compare(a.id, b.id)), rows: rows.sort((a, b) => compare(a.id, b.id)) });
}

export function loadTruth(root = repository) {
  const bytes = readFileSync(resolve(root, truthPath));
  const truth = truthSchema.parse(JSON.parse(bytes.toString()));
  if (JSON.stringify(truth) !== JSON.stringify(buildTruth(root))) throw new Error('Frozen truth or source SHA-256 mismatch; rebuild and review before evaluation');
  return { truth, digest: sha256(bytes) };
}
