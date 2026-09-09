import type { StructuredMenuItem } from "./types";
type NutritionLabel = Pick<StructuredMenuItem, "calories" | "calorieRange" | "calorieLabel" | "hasCustomizations">;
/** Price taglines contain the displayed standard-serving calories, not the chosen customization. */
export function ueNutritionLabel(text: string | undefined, customizations: boolean | undefined): NutritionLabel {
  const out: NutritionLabel = customizations === undefined ? {} : { hasCustomizations: customizations };
  const labels = (text ?? "").split(/[•·]/).map(s => s.trim()).filter(s => /\bcal(?:ories)?\b/i.test(s));
  if (!labels.length) return out;
  out.calorieLabel = labels.join(" | ");
  if (labels.length !== 1) return out;
  const match = labels[0]!.match(/^(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:,\d{3})*(?:\.\d+)?))?\s*Cal(?:ories)?\.?$/i);
  if (!match) return out;
  const low = Number(match[1]!.replace(/,/g, "")), high = match[2] ? Number(match[2].replace(/,/g, "")) : low;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low || high > 100_000) return out;
  if (match[2]) out.calorieRange = [low, high]; else out.calories = low;
  return out;
}
