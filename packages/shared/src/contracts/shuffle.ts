import { z } from 'zod';
import { restaurantResultSchema } from './restaurants';

/** Stable API-first contract for search-screen Shuffle and widget consumers. */
export const shuffleResponseSchema = z.object({
  data: z.object({
    restaurant: restaurantResultSchema.omit({ bestMatch: true }),
    item: z.object({ id: z.string().min(1), name: z.string() }).nullable(),
    macros: z.object({
      calories: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      carbsG: z.number().nonnegative(),
      fatG: z.number().nonnegative(),
      confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
      nutritionBasis: z.enum(['published', 'estimated']),
    }).nullable(),
    fitScore: z.number().gt(0).lte(1).nullable(),
    distanceMiles: z.number().nonnegative(),
    availability: z.enum(['open', 'unknown']),
  }).nullable(),
  meta: z.object({
    locked: z.boolean(),
    fallback: z.enum(['none', 'tolerance', 'radius']).nullable(),
    radiusMiles: z.number().positive().lte(50),
    tolerance: z.number().nonnegative().nullable(),
    emptyReason: z.literal('no_matches').nullable(),
  }),
});
export type ShuffleResponse = z.infer<typeof shuffleResponseSchema>;
