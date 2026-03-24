// ─── Macro Targets ────────────────────────────────────────────────────────────

export interface MacroTargets {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}

export type GoalType = "cut" | "bulk" | "maintain" | "custom";

// ─── Restaurant ───────────────────────────────────────────────────────────────

export interface Restaurant {
  id: string;
  externalPlaceId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  cuisineTags: string[];
  chainFlag: boolean;
  source: string;
  distanceMi?: number;
  bestMacroScore?: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Menu Items ───────────────────────────────────────────────────────────────

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  photoUrl?: string;
  category?: string;
  price?: number;
  macroEstimate?: MacroEstimate;
  createdAt: string;
  updatedAt: string;
}

// ─── Macro Estimates ──────────────────────────────────────────────────────────

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface MacroEstimate {
  id: string;
  menuItemId: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: ConfidenceLevel;
  hadPhoto: boolean;
  ingredientBreakdown?: IngredientBreakdown[];
  reasoning?: string;
  estimatedAt: string;
  expiresAt?: string;
}

export interface IngredientBreakdown {
  name: string;
  weightG?: number;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}

// ─── API Response Shapes ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
  error?: never;
}

export interface ApiError {
  error: string;
  data?: never;
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

export interface PaginationMeta {
  cursor?: string;
  hasMore: boolean;
  total?: number;
}

// ─── Restaurant Search ────────────────────────────────────────────────────────

export interface RestaurantSearchParams {
  lat: number;
  lng: number;
  radiusMi?: number;
  targets?: MacroTargets;
  cuisines?: string[];
  chainOnly?: boolean;
  independentOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface RestaurantSearchResult {
  restaurants: RestaurantWithBestItem[];
  meta: PaginationMeta;
}

export interface RestaurantWithBestItem extends Restaurant {
  bestItem?: MenuItem;
  matchingItemCount: number;
}
