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
  dietaryTags: string[]; // e.g. ["vegan", "gluten-free"]
}

export interface MenuSourceResult {
  found: boolean;
  restaurant?: {
    name: string;
    cuisine?: string[];
    priceRange?: string;
    imageUrl?: string; // restaurant hero photo (from UE JSON-LD, Google Places, etc.)
  };
  items: StructuredMenuItem[];
  macros?: Map<string, MacroData>; // populated by FFN/FatSecret; key = item name (lowercased)
  sourceId: string; // "ffn" | "fatsecret" | "ubereats" | "firecrawl" | "none"
  nameMismatch?: boolean; // S-118: true if scraped name didn't match expected name (log-only)
}

export interface MenuSource {
  id: string;
  lookup(name: string, address: string, geo?: { lat: number; lng: number }): Promise<MenuSourceResult>;
}
