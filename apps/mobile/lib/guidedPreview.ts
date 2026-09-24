import { guidedPreviewResponseSchema, type GuidedPreviewResponse } from '../../../packages/shared/src/contracts/restaurants';
import { api } from './api';
import { getMacroTargets, type StoredMacroTargets } from './macroStorage';

const CACHE_MS = 30_000;
const MAX_CONTEXTS = 10;
const cache = new Map<string, { at: number; response: GuidedPreviewResponse }>();
type Options = { signal?: AbortSignal; refresh?: boolean };

/** A short bounded preview cache includes all targets, craving and coordinates. */
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
    return cached.response;
  }
  const response = guidedPreviewResponseSchema.parse(await api.get(`/api/restaurants/preview?${params}`, false, { signal: options.signal }));
  if (options.signal?.aborted) throw new Error('Preview request cancelled');
  cache.delete(key);
  cache.set(key, { at: Date.now(), response });
  while (cache.size > MAX_CONTEXTS) cache.delete(cache.keys().next().value!);
  return response;
}
