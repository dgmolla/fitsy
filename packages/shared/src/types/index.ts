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

// ─── API Response Types (S-12 / S-13) ─────────────────────────────────────────

export interface BestMatchSummary {
  menuItemId: string;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: ConfidenceLevel;
  matchScore: number;
}

/** Shape of a single restaurant row in GET /api/restaurants */
export interface RestaurantResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceMiles: number;
  cuisineTags: string[];
  chainFlag: boolean;
  bestMatch: BestMatchSummary | null;
}

export interface RestaurantsMeta {
  total: number;
  limit: number;
}

export interface RestaurantsResponse {
  data: RestaurantResult[];
  meta: RestaurantsMeta;
}

export type RestaurantsApiResponse = RestaurantsResponse | ApiError;

/** Macro summary embedded in menu item response */
export interface MenuItemMacros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: ConfidenceLevel;
  hadPhoto: boolean;
  estimatedAt: string;
}

/** Shape of a single item in GET /api/restaurants/[id]/menu */
export interface MenuItemResult {
  id: string;
  name: string;
  description?: string;
  category?: string;
  price?: number;
  macros: MenuItemMacros | null;
}

export interface MenuResponse {
  restaurantId: string;
  restaurantName: string;
  menuItems: MenuItemResult[];
}

export interface MenuApiResponseBody {
  data: MenuResponse;
}

export type MenuApiResponse = MenuApiResponseBody | ApiError;

// ─── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export type AuthApiResponse = AuthResponse | ApiError;

// ─── Saved Meals ───────────────────────────────────────────────────────────────

export interface SavedItemResponse {
  id: string;
  menuItemId: string;
  restaurantId: string | null;
  itemType: "menu_item" | "restaurant";
  createdAt: string;
  menuItem: {
    id: string;
    name: string;
    description?: string;
    category?: string;
    price?: number;
    macros: MenuItemMacros | null;
    restaurant: {
      id: string;
      name: string;
      address: string;
    };
  } | null;
}

export interface SavedItemsResponse {
  data: SavedItemResponse[];
  meta: PaginationMeta;
}

// ─── Welcome Flow ──────────────────────────────────────────────────────────────

export type ActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "active"
  | "very_active";

export type UserGoal = "lose_fat" | "maintain" | "build_muscle";

export interface AppleAuthRequest {
  identityToken: string;
  authorizationCode: string;
  fullName?: { givenName?: string; familyName?: string } | null;
  email?: string | null;
}

export interface AppleAuthResponse {
  token: string;
  user: AuthUser;
  isNewUser: boolean;
}

export interface ProfileUpdateRequest {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  activityLevel?: ActivityLevel;
  goal?: UserGoal;
  onboardingStep?: number;
}

export interface SubscriptionVerifyRequest {
  receiptData: string;
  productId: string;
}

export interface SubscriptionVerifyResponse {
  success: boolean;
  plan: string;
  status: string;
  expiresAt?: string;
  macroTarget?: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
}

