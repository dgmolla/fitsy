import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { buildChainMatcher } from './chainCatalog';
import { buildBrandIdentityMatcher, officialMacro } from './chainServing';
import type { MacroData, StructuredMenuItem } from './menuSources/types';

interface RestaurantWrite { restaurantId: string; brandId?: string; items: { item: StructuredMenuItem; macro: MacroData }[] }
const proof = z.object({ kind: z.literal('reviewed-chain-v1'), chainItemId: z.string().min(1) });
/** Revalidate reviewed facts against locked current location/identity before either menu writer mutates rows. */
export async function validateReviewedChainWrites(tx: Prisma.TransactionClient, inputs: RestaurantWrite[]): Promise<void> {
  const reviewed = inputs.flatMap(input => input.items.flatMap(pair => {
    if (pair.macro.source !== 'official' || !pair.macro.reasoning) return [];
    let value: unknown;
    try { value = JSON.parse(pair.macro.reasoning); } catch { return []; }
    if (!value || typeof value !== 'object' || !('kind' in value) || value.kind !== 'reviewed-chain-v1') return [];
    const parsed = proof.safeParse(value);
    if (!parsed.success) throw new Error('Reviewed chain proof is incomplete; rebuild the menu');
    return [{ ...pair, restaurantId: input.restaurantId, brandId: input.brandId, chainItemId: parsed.data.chainItemId }];
  }));
  const restaurantIds = [...new Set(inputs.map(r => r.restaurantId))].sort();
  if (!restaurantIds.length) return;
  const catalogIds = [...new Set(reviewed.map(r => r.chainItemId))].sort();
  if (catalogIds.length) await tx.$queryRaw`SELECT id FROM "ChainItem" WHERE id IN (${Prisma.join(catalogIds)}) ORDER BY id FOR SHARE`;
  // Lock ALL target restaurants, including estimated-only ones, before any MenuItem write.
  // Otherwise a later brand/hash update can deadlock with April's Restaurant->MenuItem order.
  await tx.$queryRaw`SELECT id FROM "Restaurant" WHERE id IN (${Prisma.join(restaurantIds)}) ORDER BY id FOR UPDATE`;
  if (!reviewed.length) return;
  const restaurants = await tx.restaurant.findMany({ where: { id: { in: restaurantIds } } });
  const brands = await tx.brand.findMany({ where: { detectionConf: { in: ['high', 'llm-confirmed'] }, menuKind: 'restaurant' } });
  const identity = buildBrandIdentityMatcher(brands), byId = new Map(restaurants.map(r => [r.id, r]));
  const brandIds = [...new Set(restaurants.flatMap(r => { const id = identity(r); return id ? [id] : []; }))];
  const match = buildChainMatcher(await tx.chainItem.findMany({ where: { brandId: { in: brandIds } } }));
  for (const pair of reviewed) {
    const restaurant = byId.get(pair.restaurantId), brandId = restaurant ? identity(restaurant) : undefined;
    if (!restaurant || !brandId || (pair.brandId && pair.brandId !== brandId)) throw new Error('Restaurant brand changed; refusing reviewed chain handoff');
    const result = match(brandId, pair.item, restaurant);
    if (result.status !== 'matched' || result.row.id !== pair.chainItemId) throw new Error('Reviewed chain binding or location changed; rebuild the menu');
    const expected = officialMacro(result.row, pair.item);
    if (pair.macro.reasoning !== expected.reasoning || pair.macro.confidence !== expected.confidence
      || ['calories', 'proteinG', 'carbsG', 'fatG'].some(key => pair.macro[key as 'calories'] !== expected[key as 'calories'])) {
      throw new Error('Reviewed chain facts changed; rebuild the menu');
    }
  }
}
