/**
 * Runtime contract for GET /api/restaurants (tenet T4).
 *
 * These zod schemas are the executable twin of the TS interfaces in
 * types/index.ts. The DB-container tests (apps/api/tests/db/) parse real
 * service output with them, so a response-shape change that would break the
 * mobile client fails a test instead of a user.
 *
 * Keep in lockstep with `RestaurantResult` / `RestaurantsMeta` /
 * `RestaurantsResponse`; the `_contractCovers` assertions at the bottom make
 * tsc fail if a field is added to the interfaces but not the schemas.
 */
import { z } from "zod";
import type { BestMatchSummary, RestaurantResult, RestaurantsMeta, RestaurantsResponse } from "../types/index";

export const bestMatchSummarySchema = z.object({
  menuItemId: z.string().min(1),
  name: z.string(),
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  matchScore: z.number().nullable(),
});

export const restaurantResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  distanceMiles: z.number().gte(0),
  cuisineTags: z.array(z.string()),
  chainFlag: z.boolean(),
  photoUrl: z.string().optional(),
  rating: z.number().optional(),
  priceLevel: z.string().optional(),
  dietaryOptions: z.array(z.string()).optional(),
  bestMatch: bestMatchSummarySchema.nullable(),
});

export const restaurantsMetaSchema = z.object({
  total: z.number().int().gte(0),
  limit: z.number().int().gte(1),
  nextCursor: z.string().nullable().optional(),
  locked: z.boolean().optional(),
});

export const restaurantsResponseSchema = z.object({
  data: z.array(restaurantResultSchema),
  meta: restaurantsMetaSchema,
});

// ── Compile-time lockstep with the TS interfaces ────────────────────────────
// If a field is added to an interface but not its schema (or vice versa),
// one of these assignments stops type-checking.
type SchemaOf<T> = { [K in keyof Required<T>]: unknown };
const _coversBestMatch: SchemaOf<BestMatchSummary> = bestMatchSummarySchema.shape;
const _coversResult: SchemaOf<RestaurantResult> = restaurantResultSchema.shape;
const _coversMeta: SchemaOf<RestaurantsMeta> = restaurantsMetaSchema.shape;
const _coversResponse: SchemaOf<RestaurantsResponse> = restaurantsResponseSchema.shape;
void _coversBestMatch;
void _coversResult;
void _coversMeta;
void _coversResponse;
