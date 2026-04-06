/**
 * Shared types for the MenuSource pipeline.
 *
 * Each data source (FFN, FatSecret, Uber Eats, Firecrawl) implements
 * the MenuSource interface and returns MenuSourceResult. The pipeline
 * doesn't care which source provided the data.
 */

export interface StructuredMenuItem {
  name: string;
  description?: string;
  price?: number;
  calories?: number; // calories extracted from source (e.g. UberEats markdown) — use directly when set
  category?: string; // "Entree", "Side", "Drink"
  section?: string;  // menu section heading (e.g., "Appetizers", "Salads")
}

export interface MacroData {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  source: string; // "ffn" | "fatsecret" | "haiku"
}

export interface MenuSourceResult {
  found: boolean;
  restaurant?: {
    name: string;
    cuisine?: string[];
    priceRange?: string;
  };
  items: StructuredMenuItem[];
  macros?: Map<string, MacroData>; // populated by FFN/FatSecret; key = item name (lowercased)
  sourceId: string; // "ffn" | "fatsecret" | "ubereats" | "firecrawl" | "none"
}

export interface MenuSource {
  id: string;
  lookup(name: string, address: string): Promise<MenuSourceResult>;
}
