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

export function formatTag(tag: string): string {
  return tag
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
