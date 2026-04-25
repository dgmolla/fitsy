export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function calcCalories(
  proteinG: number,
  carbsG: number,
  fatG: number,
): number {
  return Math.round(proteinG * 4 + carbsG * 4 + fatG * 9);
}

export function confidenceLabel(level: string): "High confidence" | "Estimated" | "Approximate" {
  if (level === "HIGH") return "High confidence";
  if (level === "MEDIUM") return "Estimated";
  return "Approximate";
}

export function priceSymbol(level: string | null | undefined): string {
  switch (level) {
    case "PRICE_LEVEL_INEXPENSIVE": return "$";
    case "PRICE_LEVEL_MODERATE": return "$$";
    case "PRICE_LEVEL_EXPENSIVE": return "$$$";
    case "PRICE_LEVEL_VERY_EXPENSIVE": return "$$$$";
    default: return "";
  }
}

// Combines a human-readable slug with the row id so detail pages can do an
// indexed primary-key lookup instead of a full table scan. `--` is safe as a
// separator because slugify collapses any non-alphanumeric run to a single `-`.
export function slugWithId(name: string, id: string): string {
  return `${slugify(name)}--${id}`;
}

export function parseSlugId(param: string): { slug: string; id: string } | null {
  const idx = param.lastIndexOf("--");
  if (idx === -1) return null;
  const slug = param.slice(0, idx);
  const id = param.slice(idx + 2);
  if (!slug || !id) return null;
  return { slug, id };
}

export function formatTag(tag: string): string {
  return tag
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
