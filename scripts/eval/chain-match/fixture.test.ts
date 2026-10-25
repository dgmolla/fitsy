import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as childProcess from 'node:child_process';
import { buildChainMatcher } from '../../../apps/api/services/chainCatalog';
import { assertCommittedBenchmark, benchmarkPath, benchmarkSchema, buildDecisionRequest, loadBenchmark, repository, sourcePaths } from './fixture';

afterEach(() => jest.restoreAllMocks());

test('200 real contextual LA variants, balanced by brand, freeze sources, independent labels and thresholds', () => {
  const f = loadBenchmark();
  expect(f.cases).toHaveLength(200);
  expect(f.cases.filter(c => c.match)).toHaveLength(96);
  expect(new Set(f.cases.map(c => c.observation)).size).toBe(200);
  expect(f.cases.filter(c => c.item.slug === 'waba-grill')).toHaveLength(100);
  expect(f.cases.filter(c => c.item.slug === 'yoshinoya')).toHaveLength(100);
  expect(f.cases.some(c => c.item.count === 0)).toBe(true);
  expect(f.benchmark.thresholds).toEqual({ accuracy: 0.95, falsePositiveRate: 0.01, falseDiscoveryRate: 0.01,
    recall: 0.95, recallGain: 0.02, costUsdPer1000: 0.1, p95LatencyMs: 1000, matchProbability: 0.95, noMatchProbability: 0.05, confidence: 0.9 });
  const matcher = buildChainMatcher(f.rows);
  const missedPositives = f.cases.filter(c => c.match && matcher(c.item.slug, c.item).status !== 'matched');
  expect(missedPositives.map(c => c.observation)).toEqual([21, 23]);
  expect(f.cases.some(c => !c.match && c.item.name.includes('with Veggie'))).toBe(true);
  expect(f.cases.some(c => !c.match && c.item.name.includes('Kids'))).toBe(true);
});

test('requests exclude gold labels, rationales, aliases, current estimates and baseline results', () => {
  const f = loadBenchmark(), item = f.cases.find(c => c.match)!;
  const request = buildDecisionRequest(f.benchmark, item);
  expect(request).toEqual({ model: 'jev-latest', questions: { chain_item_match: f.benchmark.question }, state: {
    menuItem: { brand: item.item.slug, name: item.item.name, section: item.item.section, description: item.item.description },
    approvedFact: { brand: item.fact.brandId, canonicalKey: item.fact.canonicalKey, servingSize: item.fact.servingSize,
      calories: item.fact.calories, proteinG: item.fact.proteinG, carbsG: item.fact.carbsG, fatG: item.fact.fatG, locator: item.fact.review.locator },
  } });
  const keys = JSON.stringify(request);
  for (const excluded of ['rationale', 'aliases', 'dataHash', 'baseline', 'observation', 'match":true']) expect(keys).not.toContain(excluded);
});

test('source changes, duplicate observations, unknown candidates and undersized datasets are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-503-fixture-'));
  try {
    for (const path of [benchmarkPath, ...Object.values(sourcePaths)]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), readFileSync(join(repository, path)));
    }
    const raw = JSON.parse(readFileSync(join(root, benchmarkPath), 'utf8'));
    for (const mutation of [
      () => { raw.cases[1].observation = raw.cases[0].observation; },
      () => { raw.cases[1].candidate = 'nonexistent:fact'; },
      () => { raw.cases.pop(); },
    ]) {
      const original = JSON.stringify(raw); mutation();
      writeFileSync(join(root, benchmarkPath), JSON.stringify(raw));
      expect(() => loadBenchmark(root)).toThrow();
      Object.assign(raw, JSON.parse(original));
    }
    writeFileSync(join(root, benchmarkPath), JSON.stringify(raw));
    writeFileSync(join(root, sourcePaths.observations), '[]');
    expect(() => loadBenchmark(root)).toThrow('Frozen source changed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unknown fields, invalid probabilities and invalid dataset size cannot change the protocol silently', () => {
  const benchmark = loadBenchmark().benchmark;
  for (const patch of [{ cases: [] }, { model: 'other-model' }, { surprise: true },
    { thresholds: { ...benchmark.thresholds, matchProbability: 2 } }]) {
    expect(benchmarkSchema.safeParse({ ...benchmark, ...patch }).success).toBe(false);
  }
});

test('an uncommitted benchmark cannot be used for live evaluation', () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-503-uncommitted-'));
  try { expect(() => assertCommittedBenchmark(root)).toThrow('commit the labeled benchmark'); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test('freeze guard requires byte-identical committed labels, thresholds, sources and execution code', () => {
  let corrupt = false;
  jest.spyOn(childProcess, 'execFileSync').mockImplementation((_command, argv) => {
    const args = argv as string[];
    if (args[0] === 'diff') return '';
    if (args[0] === 'rev-parse') return 'a'.repeat(40) + '\n';
    if (args[0] === 'show') {
      const contents = readFileSync(join(repository, args[1]!.slice(5)), 'utf8');
      return corrupt ? contents + ' ' : contents;
    }
    throw new Error('Unexpected Git command');
  });
  expect(assertCommittedBenchmark()).toBe('a'.repeat(40));
  corrupt = true;
  expect(() => assertCommittedBenchmark()).toThrow('commit the labeled benchmark');
});
