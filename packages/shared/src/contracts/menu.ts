import { z } from 'zod';
import type { MenuItemMacros, MenuItemResult, MenuResponse } from '../types/index';

export const menuItemMacrosSchema = z.object({
  calories: z.number(), proteinG: z.number(), carbsG: z.number(), fatG: z.number(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']), hadPhoto: z.boolean(), estimatedAt: z.string(),
});
export const menuItemResultSchema = z.object({
  id: z.string().min(1), name: z.string(), description: z.string().optional(),
  category: z.string().optional(), price: z.number().optional(), macros: menuItemMacrosSchema.nullable(),
});
export const menuResponseSchema = z.object({
  restaurantId: z.string().min(1), restaurantName: z.string(), rating: z.number().optional(),
  userRatingCount: z.number().optional(), menuItems: z.array(menuItemResultSchema), locked: z.boolean().optional(),
  totalItemCount: z.number().int().nonnegative().optional(), nextCursor: z.string().nullable().optional(),
});
// Keep wire-schema keys in lockstep with the client/server interfaces.
type Shape<T> = { [K in keyof Required<T>]: unknown };
const macros: Shape<MenuItemMacros> = menuItemMacrosSchema.shape;
const item: Shape<MenuItemResult> = menuItemResultSchema.shape;
const menu: Shape<MenuResponse> = menuResponseSchema.shape;
void macros; void item; void menu;
