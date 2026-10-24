import { randomUUID } from 'node:crypto';
import type { MenuItem, Prisma } from '@prisma/client';
import type { StructuredMenuItem } from '../apps/api/services/menuSources/types';
import { decodeMenuText, menuItemIdentity } from '../apps/api/services/menuSources/menuItemIdentity';

export interface IncomingMenuItem {
  restaurantId: string;
  item: StructuredMenuItem;
}
export type ExistingMenuItem = Pick<MenuItem,
  'id' | 'restaurantId' | 'name' | 'sourceItemId' | 'description' | 'section' | 'category' | 'price' | 'retiredAt'>;

function servingKey(restaurantId: string, item: {
  name: string; description?: string | null; section?: string | null; category?: string | null; price?: number | null;
}): string {
  return JSON.stringify([restaurantId, decodeMenuText(item.name)!.toLowerCase(),
    decodeMenuText(item.description), decodeMenuText(item.section), decodeMenuText(item.category), item.price ?? null]);
}

/** A legacy ID is adopted only for a unique exact serving context, never an arbitrary same-name variant. */
export function reconcileMenuItemIds(incoming: IncomingMenuItem[], existing: ExistingMenuItem[]): string[] {
  const identity = (restaurantId: string, item: Parameters<typeof menuItemIdentity>[0]) =>
    JSON.stringify([restaurantId, menuItemIdentity(item)]);
  const byIdentity = new Map<string, ExistingMenuItem[]>();
  for (const row of existing) {
    const key = identity(row.restaurantId, { ...row, sourceItemId: row.sourceItemId ?? undefined });
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), row]);
  }
  const keys = incoming.map(row => identity(row.restaurantId, row.item));
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate incoming menu product identity');
  // Reserve established identities before trying to adopt legacy rows.
  const ids = keys.map((key, index) => {
    const matches = byIdentity.get(key) ?? [];
    const active = matches.filter(row => !row.retiredAt);
    const candidates = active.length ? active : matches;
    if (candidates.length === 1) return candidates[0]!.id;
    // Old case-sensitive uniqueness could leave several name-fallback rows.
    // Preserve a unique exact display name, otherwise require a unique serving context.
    const row = incoming[index]!;
    const exact = candidates.filter(candidate => candidate.name === decodeMenuText(row.item.name));
    if (exact.length === 1) return exact[0]!.id;
    const serving = candidates.filter(candidate => servingKey(candidate.restaurantId, candidate) === servingKey(row.restaurantId, row.item));
    return serving.length === 1 ? serving[0]!.id : undefined;
  });
  const reserved = new Set(ids.filter((id): id is string => !!id));
  const contexts = new Map<string, number>();
  for (const row of incoming) {
    const key = servingKey(row.restaurantId, row.item);
    contexts.set(key, (contexts.get(key) ?? 0) + 1);
  }
  const legacy = new Map<string, ExistingMenuItem[]>();
  for (const row of existing) {
    if (row.sourceItemId || row.retiredAt || reserved.has(row.id)) continue;
    const key = servingKey(row.restaurantId, row);
    legacy.set(key, [...(legacy.get(key) ?? []), row]);
  }
  return incoming.map((row, index) => {
    if (ids[index]) return ids[index]!;
    const key = servingKey(row.restaurantId, row.item);
    const candidates = legacy.get(key) ?? [];
    if (row.item.sourceItemId?.trim() && contexts.get(key) === 1 && candidates.length === 1) {
      return candidates[0]!.id;
    }
    return randomUUID();
  });
}

export async function resolveMenuItemIds(incoming: IncomingMenuItem[], tx: Prisma.TransactionClient): Promise<string[]> {
  if (!incoming.length) return [];
  const restaurantIds = [...new Set(incoming.map(row => row.restaurantId))];
  // Both writers take the same ordered parent locks. Unique indexes remain the final guard.
  await tx.$queryRaw`SELECT id FROM "Restaurant" WHERE id = ANY(${restaurantIds}::text[]) ORDER BY id FOR UPDATE`;
  // Mark the locked parent as written without changing its data. A waiter with an older
  // SERIALIZABLE snapshot must restart before resolving identities, not insert from a stale view.
  await tx.$executeRaw`UPDATE "Restaurant" SET "updatedAt" = "updatedAt" WHERE id = ANY(${restaurantIds}::text[])`;
  const existing = await tx.$queryRaw<ExistingMenuItem[]>`
    SELECT id, "restaurantId", name, "sourceItemId", description, section, category, price, "retiredAt"
    FROM "MenuItem" WHERE "restaurantId" = ANY(${restaurantIds}::text[])
    ORDER BY "updatedAt" DESC, id
  `;
  return reconcileMenuItemIds(incoming, existing);
}

export async function retireMissingMenuItems(restaurantIds: string[], menuItemIds: string[], tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`
    UPDATE "MenuItem" SET "retiredAt" = now(), "updatedAt" = now()
    WHERE "restaurantId" = ANY(${restaurantIds}::text[])
      AND id <> ALL(${menuItemIds}::text[]) AND "retiredAt" IS NULL
  `;
}
