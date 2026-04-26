import type { PreviewRestaurant } from './previewSearch';

/** Shared cache so the finding screen can pre-fetch for the results screen. */
export const prefetchedRestaurants: { data: PreviewRestaurant[] | null } = { data: null };
