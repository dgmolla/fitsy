import { guidedPreviewResponseSchema, type GuidedPreviewResponse } from '../../../packages/shared/src/contracts/restaurants';
import { api } from './api';
import { getMacroTargets, type StoredMacroTargets } from './macroStorage';

const CACHE_MS = 30_000;
const MAX_CONTEXTS = 10;
const cache = new Map<string, { at: number; response: GuidedPreviewResponse }>();
type Options = { signal?: AbortSignal; selectedItemId?: string; refresh?: boolean };

/** A short bounded cache carries the just-viewed search into its paywall.
 * Each entry includes all targets, craving and coordinates; unrelated searches never share proof. */
export async function fetchGuidedPreview(area: { lat: number; lng: number }, craving = '', suppliedTargets?: StoredMacroTargets | null, options: Options = {}): Promise<GuidedPreviewResponse> {
  const targets = suppliedTargets === undefined ? await getMacroTargets() : suppliedTargets;
  const params = new URLSearchParams({ guided: '1', lat: String(area.lat), lng: String(area.lng), q: craving.trim() });
  for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) {
    const value = Number(targets?.[key]);
    if (Number.isFinite(value) && value > 0) params.set(key, String(value));
  }
  if (options.signal?.aborted) throw new Error('Preview request cancelled');
  const key = params.toString();
  const cached = cache.get(key);
  if (!options.refresh && cached && Date.now() - cached.at < CACHE_MS) {
    const selected = options.selectedItemId;
    if (!selected) return cached.response;
    // Top-three picks came from this exact qualifying set. Reuse its total
    // without another request when moving directly from a pick to the paywall.
    if (cached.response.data.some(r => r.bestMatch?.menuItemId === selected) && cached.response.meta.goalMatch) {
      return { ...cached.response, meta: { ...cached.response.meta, goalMatch: {
        ...cached.response.meta.goalMatch, selectedItemMatches: true,
        additionalDishCount: Math.max(0, cached.response.meta.goalMatch.matchingDishCount - 1),
      } } };
    }
  }
  if (options.selectedItemId) params.set('selectedItemId', options.selectedItemId);
  const response = guidedPreviewResponseSchema.parse(await api.get(`/api/restaurants/preview?${params}`, false, { signal: options.signal }));
  if (options.signal?.aborted) throw new Error('Preview request cancelled');
  if (!options.selectedItemId) {
    cache.delete(key);
    cache.set(key, { at: Date.now(), response });
    while (cache.size > MAX_CONTEXTS) cache.delete(cache.keys().next().value!);
  }
  return response;
}
