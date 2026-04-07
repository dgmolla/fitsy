/**
 * Shared constants and pure utilities for preload pipeline scripts.
 */

/** Minimum number of menu items with a dietary tag for it to count as a restaurant dietary option. */
export const DIETARY_TAG_THRESHOLD = 3;

/**
 * Given an array of per-item dietary tag arrays, return the restaurant-level
 * dietary options. A tag must appear on at least DIETARY_TAG_THRESHOLD items
 * to produce a "has_{tag}" entry.
 *
 * @param itemTagGroups - each element is the dietaryTags array for one menu item
 */
export function aggregateDietaryOptions(itemTagGroups: string[][]): string[] {
  const tagCounts = new Map<string, number>();
  for (const tags of itemTagGroups) {
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const dietaryOptions: string[] = [];
  for (const [tag, count] of tagCounts) {
    if (count >= DIETARY_TAG_THRESHOLD) {
      dietaryOptions.push(`has_${tag}`);
    }
  }
  return dietaryOptions;
}
