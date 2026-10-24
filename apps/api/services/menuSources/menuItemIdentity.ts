import { createHash } from 'node:crypto';
import type { StructuredMenuItem } from './types';

export function sourceItemId(item: Pick<StructuredMenuItem, 'sourceItemId'>): string | null {
  return item.sourceItemId?.trim() || null;
}

// Match the stored display name, including entities decoded by the pipeline.
export function decodeMenuText(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  return text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
}

export function menuItemIdentity(item: Pick<StructuredMenuItem, 'name' | 'sourceItemId'>): string {
  const id = sourceItemId(item);
  return id ? `source:${id}` : `name:${decodeMenuText(item.name)!.toLowerCase()}`;
}

/** Versioned to invalidate old name-only hashes, even for unchanged menus. */
export function computeMenuHash(items: StructuredMenuItem[]): string {
  const entries = items.map(item => [menuItemIdentity(item), item.name, item.description ?? null,
    item.section ?? null, item.category ?? null, item.price ?? null, item.calories ?? null, item.calorieLabel ?? null,
    item.calorieRange ?? null, item.hasCustomizations ?? null]);
  entries.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(['source-identity-v1', entries])).digest('hex').slice(0, 16);
}
