import { z } from 'zod';

/** Meal-target closeness only, not a prediction of fitness outcomes. Every active dimension must qualify. */
export const GOAL_MATCH_POLICY = 'within-20-percent-v1' as const;
export const GOAL_MATCH_TOLERANCE = 0.2;

export const goalMatchSchema = z.object({
  policy: z.literal(GOAL_MATCH_POLICY),
  activeTargets: z.object({
    calories: z.number().positive().optional(),
    proteinG: z.number().positive().optional(),
    carbsG: z.number().positive().optional(),
    fatG: z.number().positive().optional(),
  }),
  matchingDishCount: z.number().int().nonnegative(),
  additionalDishCount: z.number().int().nonnegative(),
  selectedItemMatches: z.boolean(),
});
export type GoalMatch = z.infer<typeof goalMatchSchema>;
