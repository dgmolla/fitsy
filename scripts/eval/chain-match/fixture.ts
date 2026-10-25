import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { approvedChainRow, chainReviewHash, type ChainCatalogRow } from '../../../apps/api/services/chainCatalog';
import { chainCatalogBatchSchema } from '../../../apps/api/services/chainCatalogBatch';
import type { JevDecisionRequest } from '../../../apps/api/services/jevDecisionService';

export const repository = resolve(__dirname, '../../..');
export const benchmarkPath = 'scripts/eval/chain-match/benchmark.json';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1);
const fraction = z.number().finite().min(0).max(1);
export const benchmarkSchema = z.object({
  version: z.literal(1), decision: z.literal('chain-item-match'), model: z.literal('jev-latest'),
  labeling: text, sampling: text,
  sources: z.object({ observations: hash, catalog: hash, bindingTruth: hash }).strict(),
  pricing: z.object({ inputUsdPerMillion: z.number().positive(), outputUsdPerMillion: z.literal(0), source: text, checkedAt: text }).strict(),
  thresholds: z.object({ accuracy: fraction, falsePositiveRate: fraction, falseDiscoveryRate: fraction,
    recall: fraction, recallGain: fraction, costUsdPer1000: z.number().positive(), p95LatencyMs: z.number().positive(),
    matchProbability: fraction, noMatchProbability: fraction, confidence: fraction }).strict(),
  question: z.object({ type: z.literal('choice'), instructions: text,
    criteria: z.object({ match: text, no_match: text }).strict() }).strict(),
  cases: z.array(z.object({ id: text, observation: z.number().int().nonnegative(), candidate: text,
    match: z.boolean(), rationale: text }).strict()).length(200),
}).strict();
export type Benchmark = z.infer<typeof benchmarkSchema>;
export const sourcePaths = {
  observations: 'apps/api/tests/fixtures/__snapshots__/chain-batch-observations.json',
  catalog: 'apps/api/services/chainCatalogs/waba-yoshinoya-2026-09.json',
  bindingTruth: 'apps/api/tests/fixtures/chain-batch-truth.ts',
} as const;
// count=0 identifies a captured LA UE variant absent from the older DB inventory.
const observationSchema = z.object({ slug: text, name: text, section: z.string(), description: z.string(), count: z.number().int().nonnegative() });
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function loadBenchmark(root = repository) {
  const contents = readFileSync(resolve(root, benchmarkPath));
  const benchmark = benchmarkSchema.parse(JSON.parse(contents.toString()));
  for (const [key, path] of Object.entries(sourcePaths)) {
    if (sha256(readFileSync(resolve(root, path))) !== benchmark.sources[key as keyof typeof sourcePaths]) {
      throw new Error(`Frozen source changed: ${path}`);
    }
  }
  const observations = z.array(observationSchema).parse(JSON.parse(readFileSync(resolve(root, sourcePaths.observations), 'utf8')));
  const catalog = chainCatalogBatchSchema.parse(JSON.parse(readFileSync(resolve(root, sourcePaths.catalog), 'utf8')));
  const rows = catalog.changes.map(definition => {
    const row: ChainCatalogRow = { id: `${definition.slug}:${definition.canonicalKey}`, brandId: definition.slug,
      canonicalKey: definition.canonicalKey, ...definition.facts, source: 'official', confidence: 'HIGH',
      officialUrl: definition.source.url, review: null };
    const evidence = { version: 1 as const, sourceHash: definition.source.sha256, locator: definition.locator,
      reviewedBy: catalog.reviewedBy, aliases: definition.aliases,
      ...(definition.allulose ? { allulose: definition.allulose } : {}),
      ...(definition.usStates ? { usStates: definition.usStates } : {}),
      ...(definition.storeScope ? { storeScope: definition.storeScope } : {}) };
    const approved = approvedChainRow({ ...row, review: { ...evidence, dataHash: chainReviewHash(row, evidence) } });
    if (!approved) throw new Error(`Invalid reference fact: ${row.id}`);
    return approved;
  });
  const ids = new Set<string>(), items = new Set<string>();
  const cases = benchmark.cases.map(label => {
    const item = observations[label.observation], fact = rows.find(row => row.id === label.candidate);
    if (!item || !fact || ids.has(label.id) || items.has(JSON.stringify(item))) throw new Error(`Invalid or duplicate case: ${label.id}`);
    ids.add(label.id); items.add(JSON.stringify(item));
    return { ...label, item, fact };
  });
  if (!cases.some(c => c.match) || !cases.some(c => !c.match)) throw new Error('Both label classes are required');
  return { benchmark, cases, rows, digest: sha256(contents) };
}
export type Fixture = ReturnType<typeof loadBenchmark>;

/** Deliberate allowlist: labels, rationale, aliases, baseline and estimated DB macros never reach Jev. */
export function buildDecisionRequest(benchmark: Benchmark, item: Fixture['cases'][number]): JevDecisionRequest {
  return { model: benchmark.model, questions: { chain_item_match: benchmark.question }, state: {
    menuItem: { brand: item.item.slug, name: item.item.name, section: item.item.section, description: item.item.description },
    approvedFact: { brand: item.fact.brandId, canonicalKey: item.fact.canonicalKey, servingSize: item.fact.servingSize,
      calories: item.fact.calories, proteinG: item.fact.proteinG, carbsG: item.fact.carbsG, fatG: item.fact.fatG,
      locator: item.fact.review.locator },
  } };
}

/** A hash alone is insufficient: require the labeled protocol and executing code in a clean commit. */
export function assertCommittedBenchmark(root = repository): string {
  const paths = [benchmarkPath, ...Object.values(sourcePaths), 'scripts/eval/chain-match/fixture.ts',
    'scripts/eval/chain-match/score.ts', 'scripts/eval/chain-match/run.ts', 'scripts/eval/run-eval.ts',
    'apps/api/services/jevDecisionService.ts'];
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    // Includes staged edits. Existing imported matcher/metric dependencies must also be clean.
    git(['diff', '--quiet', 'HEAD', '--']);
    for (const path of paths) {
      if (!Buffer.from(git(['show', `HEAD:${path}`])).equals(readFileSync(resolve(root, path)))) throw new Error('Uncommitted input');
    }
    return git(['rev-parse', 'HEAD']).trim();
  } catch {
    throw new Error('Live evaluation stopped: commit the labeled benchmark, frozen thresholds and runner before any model calls');
  }
}
