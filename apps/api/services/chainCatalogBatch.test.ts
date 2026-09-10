import { chainCatalogBatchSchema } from './chainCatalogBatch';
import { chainPilot } from './chainPilotData';
import { planChainPilot } from './chainPilotPlan';
import type { Brand, ChainItem } from '@prisma/client';

const now = new Date('2026-09-09'), slug = 'batch-chain';
const brand: Brand = { id: slug, slug, displayName: slug, aliases: [], locationCount: 1, menuKind: 'restaurant', bestPair: null, distinctive: true, detectionConf: 'high', macroSource: null, officialUrl: null, createdAt: now, updatedAt: now };
const definition = { ...chainPilot.changes[0]!, slug, expected: null };
const batch = () => chainCatalogBatchSchema.parse({ version: 1, reviewedBy: 'Source audit', changes: [definition], quarantine: [] });

test('arbitrary chain batches validate; duplicate keys, conflicting baselines and malformed sources reject', () => {
  const valid = batch();
  expect(valid.changes[0]!.slug).toBe(slug);
  for (const patch of [{ changes: [definition, definition] }, { changes: [], quarantine: [] },
    { changes: [{ ...definition, source: { ...definition.source, url: 'http://example.com' } }] },
    { changes: [{ ...definition, source: { ...definition.source, sha256: 'invalid' } }] },
    { changes: [{ ...definition, facts: { ...definition.facts, calories: -1 } }] },
    { changes: [{ ...definition, facts: { ...definition.facts, servingSize: ' ' } }] },
    { changes: [{ ...definition, expected: chainPilot.quarantine[0]!.expected }] },
    { unexpected: true }]) expect(chainCatalogBatchSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
});

test('expanding an approved alias requires the exact previous approval and invalidates its old digest', () => {
  const initial = batch(), first = planChainPilot([brand], [], initial).changes[0]!.desired;
  const existing: ChainItem = { ...first, id: 'existing', retrievedAt: now, createdAt: now, updatedAt: now };
  expect(planChainPilot([brand], [existing], initial).changes).toEqual([]);
  const { brandId: _brandId, review, ...expected } = first;
  const expanded = batch();
  expanded.changes[0]!.aliases.push({ name: 'Chicken Plate', section: 'Popular', description: 'Standard plate' });
  expect(() => planChainPilot([brand], [existing], expanded)).toThrow('baseline');
  expanded.changes[0]!.expected = { ...expected, review: chainCatalogBatchSchema.parse(initial).changes[0]!.expected?.review ?? undefined };
  expect(() => planChainPilot([brand], [existing], expanded)).toThrow('baseline');
  expanded.changes[0]!.expected = chainCatalogBatchSchema.parse({ ...expanded, changes: [{ ...expanded.changes[0], expected: { ...expected, review } }] }).changes[0]!.expected;
  const next = planChainPilot([brand], [existing], expanded).changes[0]!;
  expect(next.before?.id).toBe('existing');
  expect(next.desired.review).not.toEqual(review);
  expect(planChainPilot([brand], [{ ...existing, ...next.desired }], expanded).changes).toEqual([]);
});
