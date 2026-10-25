import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { approvedChainRow, buildChainMatcher, chainBindingFingerprint, chainMenuFingerprint } from './chainCatalog';
import { buildBrandIdentityMatcher, officialMacro } from './chainServing';
import { planChainPilot, stateHash } from './chainPilotPlan';
import type { ChainCatalogBatch } from './chainCatalogBatch';
import { pickWinningEstimate } from '../../../packages/shared/src/utils/macroProvenance';

/** Same explicit LA rollout area as the retained source collision audit. */
export const LA_CHAIN_BOUNDS = { minLat: 33.7, maxLat: 34.35, minLng: -118.75, maxLng: -117.65 };
const text = z.string().min(1), num = z.number().finite(), date = z.coerce.date();
const macros = { calories: num.nullable(), proteinG: num.nullable(), carbsG: num.nullable(), fatG: num.nullable() };
const brand = z.object({ id: text, slug: text, displayName: text, aliases: z.array(z.string()), detectionConf: z.string().nullable(),
  menuKind: text, locationCount: num, bestPair: num.nullable(), distinctive: z.boolean(), macroSource: z.string().nullable(),
  officialUrl: z.string().nullable(), createdAt: date, updatedAt: date });
const catalog = z.object({ id: text, brandId: text, canonicalKey: text, aliases: z.array(z.string()), ...macros,
  servingSize: z.string().nullable(), source: text, confidence: text, officialUrl: z.string().nullable(), review: z.json(),
  retrievedAt: date.nullable(), createdAt: date, updatedAt: date });
export const chainCoverageSnapshotSchema = z.object({
  version: z.literal(1), origin: z.enum(['production', 'fixture', 'development']), capturedAt: z.string().datetime(),
  targetHash: text, runtime: text, readOnly: z.literal(true),
  sourceIdentity: z.object({ sourceItemId: z.boolean(), retiredAt: z.boolean() }),
  bounds: z.object({ minLat: num, maxLat: num, minLng: num, maxLng: num }),
  brands: z.array(brand), catalog: z.array(catalog),
  restaurants: z.array(z.object({ id: text, name: text, brandId: text.nullable(), lat: num, lng: num })),
  items: z.array(z.object({ id: text, restaurantId: text, name: text, sourceItemId: text.nullable(),
    section: z.string().nullable(), description: z.string().nullable(), retiredAt: date.nullable(), ...macros,
    macroEstimates: z.array(z.object({ source: z.string().nullable(), confidence: text, reasoning: z.string().nullable(),
      estimatedAt: date, ...macros })) })),
}).strict();
export type ChainCoverageSnapshot = z.infer<typeof chainCoverageSnapshotSchema>;

/** Database-enforced read-only, repeatable snapshot. No catalog or menu writer is called. */
export async function readChainCoverageSnapshot(prisma: PrismaClient,
  metadata: Pick<ChainCoverageSnapshot, 'origin' | 'targetHash' | 'runtime'>): Promise<ChainCoverageSnapshot> {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const columns = await tx.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'MenuItem' AND column_name IN ('sourceItemId', 'retiredAt')`;
    const sourceIdentity = { sourceItemId: columns.some(c => c.column_name === 'sourceItemId'), retiredAt: columns.some(c => c.column_name === 'retiredAt') };
    const bounds = LA_CHAIN_BOUNDS;
    const restaurants = await tx.restaurant.findMany({ where: { menuKind: 'restaurant',
      OR: [{ chainFlag: true }, { brandId: { not: null } }],
      lat: { gte: bounds.minLat, lte: bounds.maxLat }, lng: { gte: bounds.minLng, lte: bounds.maxLng } },
      select: { id: true, name: true, brandId: true, lat: true, lng: true }, orderBy: { id: 'asc' } });
    const brands = await tx.brand.findMany({ orderBy: { id: 'asc' } });
    const catalog = await tx.chainItem.findMany({ orderBy: { id: 'asc' } });
    const items = await tx.menuItem.findMany({ where: { restaurantId: { in: restaurants.map(r => r.id) }, ...(sourceIdentity.retiredAt ? { retiredAt: null } : {}) },
      select: { id: true, restaurantId: true, name: true, sourceItemId: sourceIdentity.sourceItemId, section: true, description: true, retiredAt: sourceIdentity.retiredAt,
        calories: true, proteinG: true, carbsG: true, fatG: true, macroEstimates: { select: {
          source: true, confidence: true, reasoning: true, estimatedAt: true, calories: true, proteinG: true, carbsG: true, fatG: true } } },
      orderBy: { id: 'asc' } });
    return chainCoverageSnapshotSchema.parse({ version: 1, ...metadata, capturedAt: new Date().toISOString(),
      readOnly: true, sourceIdentity, bounds, brands, catalog, restaurants,
      items: items.map(i => ({ ...i, sourceItemId: i.sourceItemId ?? null, retiredAt: i.retiredAt ?? null })) });
  }, { isolationLevel: 'RepeatableRead', timeout: 120_000 });
}

const emptyCounts = () => ({ items: 0, matched: 0, unmatched: 0, ambiguous: 0, identityHolds: 0, servedOfficial: 0, consistentOfficial: 0 });
const share = (counts: ReturnType<typeof emptyCounts>) => counts.items ? counts.matched / counts.items : 0;

/** Compare the very same active menu cohort with the installed catalog and an offline proposed catalog. */
export function auditChainCoverage(input: unknown, proposal?: ChainCatalogBatch, targetShare?: number) {
  const snapshot = chainCoverageSnapshotSchema.parse(input);
  if (stateHash(snapshot.bounds) !== stateHash(LA_CHAIN_BOUNDS)) throw new Error('Expected the explicit LA rollout bounds');
  if (targetShare !== undefined && (!Number.isFinite(targetShare) || targetShare <= 0 || targetShare > 1)) throw new Error('Target share must be in (0, 1]');
  for (const rows of [snapshot.brands, snapshot.catalog, snapshot.restaurants, snapshot.items]) {
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Duplicate snapshot identity');
  }
  const brands = new Map(snapshot.brands.map(b => [b.id, b]));
  const restaurants = new Map(snapshot.restaurants.map(r => [r.id, r]));
  if (snapshot.catalog.some(row => !brands.has(row.brandId)) || snapshot.restaurants.some(r => r.brandId && !brands.has(r.brandId))
    || snapshot.items.some(i => !restaurants.has(i.restaurantId))) throw new Error('Incomplete snapshot relationships');
  if (snapshot.restaurants.some(r => r.lat < LA_CHAIN_BOUNDS.minLat || r.lat > LA_CHAIN_BOUNDS.maxLat
    || r.lng < LA_CHAIN_BOUNDS.minLng || r.lng > LA_CHAIN_BOUNDS.maxLng)) throw new Error('Restaurant outside the LA cohort');
  const plan = proposal ? planChainPilot(snapshot.brands, snapshot.catalog, proposal) : undefined;
  const replacements = new Set(plan?.changes.map(c => `${c.desired.brandId}:${c.desired.canonicalKey}`));
  const projected = [...snapshot.catalog.filter(c => !replacements.has(`${c.brandId}:${c.canonicalKey}`)),
    ...(plan?.changes.map(c => ({ ...c.desired, id: c.before?.id ?? `proposal:${c.desired.brandId}:${c.desired.canonicalKey}` })) ?? [])];
  const identity = buildBrandIdentityMatcher(snapshot.brands);
  const beforeMatch = buildChainMatcher(snapshot.catalog), afterMatch = buildChainMatcher(projected);
  const chains = [...new Set(snapshot.restaurants.map(r => r.brandId))].map(brandId => {
    const b = brandId ? brands.get(brandId)! : undefined;
    return { brandId, slug: b?.slug ?? '(unclassified)', name: b?.displayName ?? 'Unclassified chain locations',
      restaurants: snapshot.restaurants.filter(r => r.brandId === brandId).length,
      approvedFactsBefore: snapshot.catalog.filter(c => c.brandId === brandId && approvedChainRow(c)).length,
      approvedFactsAfter: projected.filter(c => c.brandId === brandId && approvedChainRow(c)).length,
      before: emptyCounts(), after: emptyCounts() };
  });
  const byBrand = new Map(chains.map(c => [c.brandId, c]));
  type Variant = { sourceItemId: string | null; rows: number; sampleItemIds: string[] };
  const groups = new Map<string, { slug: string; name: string; section: string | null; description: string | null;
    rows: number; restaurantIds: Set<string>; variants: Map<string, Variant> }>();
  let retiredRowsExcluded = 0, lostMatches = 0;
  for (const item of snapshot.items) {
    if (item.retiredAt) { retiredRowsExcluded++; continue; }
    const restaurant = restaurants.get(item.restaurantId)!, chain = byBrand.get(restaurant.brandId)!;
    const brandId = identity(restaurant);
    const menu = { name: item.name, ...(item.section !== null ? { section: item.section } : {}),
      ...(item.description !== null ? { description: item.description } : {}), ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}) };
    const before = beforeMatch(brandId, menu, restaurant), after = afterMatch(brandId, menu, restaurant);
    const winner = pickWinningEstimate(item.macroEstimates);
    for (const [counts, result] of [[chain.before, before], [chain.after, after]] as const) {
      counts.items++; counts[result.status]++;
      if (!brandId) counts.identityHolds++;
      if (winner?.source === 'official') counts.servedOfficial++;
      if (result.status === 'matched' && winner?.source === 'official' && winner.confidence === 'HIGH') {
        if (winner.reasoning === officialMacro(result.row, menu).reasoning && (['calories', 'proteinG', 'carbsG', 'fatG'] as const)
          .every(k => winner[k] === result.row[k] && item[k] === winner[k])) counts.consistentOfficial++;
      }
    }
    if (before.status === 'matched' && after.status !== 'matched') lostMatches++;
    if (after.status !== 'matched') {
      const key = chain.slug + ':' + chainMenuFingerprint(menu);
      const group = groups.get(key) ?? { slug: chain.slug, name: item.name, section: item.section, description: item.description,
        rows: 0, restaurantIds: new Set<string>(), variants: new Map<string, Variant>() };
      group.rows++; group.restaurantIds.add(restaurant.id);
      const variantKey = chainBindingFingerprint(menu);
      const variant = group.variants.get(variantKey) ?? { sourceItemId: item.sourceItemId, rows: 0, sampleItemIds: [] };
      variant.rows++;
      if (variant.sampleItemIds.length < 5) variant.sampleItemIds.push(item.id);
      group.variants.set(variantKey, variant);
      groups.set(key, group);
    }
  }
  const total = (key: 'before' | 'after') => chains.reduce((sum, chain) => {
    for (const field of Object.keys(sum) as (keyof typeof sum)[]) sum[field] += chain[key][field];
    return sum;
  }, emptyCounts());
  const before = total('before'), after = total('after');
  if (!before.items) throw new Error('No active LA chain rows; refusing an empty coverage report');
  if (lostMatches) throw new Error(`Proposal loses ${lostMatches} existing matches; resolve the regression before rollout`);
  return { version: 1, proposalsOnly: true, applied: false, origin: snapshot.origin, capturedAt: snapshot.capturedAt,
    runtime: snapshot.runtime, targetHash: snapshot.targetHash, readOnly: true, bounds: snapshot.bounds,
    sourceIdentity: snapshot.sourceIdentity,
    snapshotHash: stateHash(snapshot), proposalHash: proposal ? stateHash(proposal) : null, retiredRowsExcluded,
    totals: { before, after, beforeShare: share(before), projectedShare: share(after), additionalMatches: after.matched - before.matched,
      targetShare: targetShare ?? null, targetMet: targetShare === undefined ? null : share(after) >= targetShare,
      additionalRowsNeeded: targetShare === undefined ? null : Math.max(0, Math.ceil(targetShare * after.items) - after.matched) },
    chains: chains.sort((a, b) => b.after.unmatched + b.after.ambiguous - a.after.unmatched - a.after.ambiguous || a.slug.localeCompare(b.slug))
      .map(c => ({ ...c, beforeShare: share(c.before), projectedShare: share(c.after) })),
    unmatchedGroups: [...groups.values()].sort((a, b) => b.rows - a.rows || a.slug.localeCompare(b.slug) || a.name.localeCompare(b.name))
      .map(({ restaurantIds, variants, ...group }) => ({ ...group, restaurants: restaurantIds.size,
        variants: [...variants.values()].sort((a, b) => b.rows - a.rows || (a.sourceItemId ?? '').localeCompare(b.sourceItemId ?? '')) })),
    limits: 'After is an offline projection over the same snapshot, not applied or served coverage. Exact aliases and source hashes require source review. No new menus, geography or live writes.',
  };
}
