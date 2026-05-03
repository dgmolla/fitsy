/**
 * Filter, sort, and tag-derivation helpers for the restaurant detail screen.
 * Pulled out of `[id].tsx` so the screen stays under the 300-line limit and
 * the predicates are unit-testable in isolation if we ever add tests for them.
 *
 * The menu API does not yet expose `MenuItem.dietaryTags` (the column exists
 * in Postgres but the response shape is intentionally out of scope for S-229),
 * so we derive vegan / gluten-free / spicy signals client-side from name and
 * description text. This is intentionally conservative — a false negative is
 * better than a false positive when users may make dietary decisions.
 */

import type { MenuItemResult } from '@fitsy/shared';
import type { MacroValues } from '@/lib/macroPresets';

export type ChipId =
  | 'high_protein'
  | 'under_700_cal'
  | 'vegan'
  | 'gluten_free'
  | 'under_15'
  | 'spicy';

export type SortId = 'match' | 'protein' | 'calories' | 'price';

export const CHIP_DEFS: { id: ChipId; label: string }[] = [
  { id: 'high_protein', label: 'High protein' },
  { id: 'under_700_cal', label: 'Under 700 cal' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'gluten_free', label: 'Gluten free' },
  { id: 'under_15', label: 'Under $15' },
  { id: 'spicy', label: 'Spicy' },
];

export const SORT_DEFS: { id: SortId; label: string }[] = [
  { id: 'match', label: 'Match' },
  { id: 'protein', label: 'Protein' },
  { id: 'calories', label: 'Calories' },
  { id: 'price', label: 'Price' },
];

const VEGAN_PATTERNS = /\b(vegan|tofu|tempeh|seitan|plant[- ]based)\b/i;
const NON_VEGAN_PATTERNS = /\b(chicken|beef|pork|salmon|tuna|shrimp|bacon|cheese|egg|yogurt|butter|milk|cream|fish|lamb|turkey|prosciutto|ham)\b/i;
const GLUTEN_FREE_PATTERNS = /\b(gluten[- ]free|gf\b)\b/i;
const GLUTEN_PATTERNS = /\b(bread|bun|pasta|noodle|wheat|tortilla|flour|pita|naan|crouton|breaded)\b/i;
const SPICY_PATTERNS = /\b(spicy|sriracha|jalape[ñn]o|habanero|chipotle|buffalo|cayenne|chili|hot sauce|szechuan|fiery|peri[- ]?peri)\b/i;

/** Tags inferred from item text — used by both filter chips and badge row. */
export interface DerivedTags {
  vegan: boolean;
  glutenFree: boolean;
  spicy: boolean;
}

export function deriveTags(item: MenuItemResult): DerivedTags {
  const text = `${item.name} ${item.description ?? ''}`;
  return {
    vegan: VEGAN_PATTERNS.test(text) && !NON_VEGAN_PATTERNS.test(text),
    glutenFree:
      GLUTEN_FREE_PATTERNS.test(text) ||
      (text.length > 0 && !GLUTEN_PATTERNS.test(text) && /\b(bowl|salad|grilled)\b/i.test(text)),
    spicy: SPICY_PATTERNS.test(text),
  };
}

const HIGH_PROTEIN_FLOOR = 30; // grams — matches "high protein" framing in onboarding copy.

/** Returns true if the item passes the chip filter. */
export function chipMatches(
  chip: ChipId,
  item: MenuItemResult,
  tags: DerivedTags,
  targets: MacroValues | null,
): boolean {
  switch (chip) {
    case 'high_protein': {
      // Prefer user's own target if set; otherwise fall back to a sane floor.
      const target = targets?.protein ? Number(targets.protein) : 0;
      const threshold = target > 0 ? Math.max(target * 0.6, HIGH_PROTEIN_FLOOR) : HIGH_PROTEIN_FLOOR;
      return (item.macros?.proteinG ?? 0) >= threshold;
    }
    case 'under_700_cal':
      return (item.macros?.calories ?? Infinity) < 700;
    case 'vegan':
      return tags.vegan;
    case 'gluten_free':
      return tags.glutenFree;
    case 'under_15':
      return (item.price ?? Infinity) < 15;
    case 'spicy':
      return tags.spicy;
  }
}

/** Apply free-text search across name + description. */
export function textMatches(item: MenuItemResult, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    (item.description ?? '').toLowerCase().includes(q)
  );
}

/** Sort comparator factory. Items without macros sink to the bottom. */
export function compareBySort(
  a: { item: MenuItemResult; pct: number },
  b: { item: MenuItemResult; pct: number },
  sort: SortId,
): number {
  switch (sort) {
    case 'match':
      return b.pct - a.pct;
    case 'protein':
      return (b.item.macros?.proteinG ?? -1) - (a.item.macros?.proteinG ?? -1);
    case 'calories': {
      // Lower calories first; missing macros sink.
      const av = a.item.macros?.calories ?? Number.POSITIVE_INFINITY;
      const bv = b.item.macros?.calories ?? Number.POSITIVE_INFINITY;
      return av - bv;
    }
    case 'price': {
      const av = a.item.price ?? Number.POSITIVE_INFINITY;
      const bv = b.item.price ?? Number.POSITIVE_INFINITY;
      return av - bv;
    }
  }
}
