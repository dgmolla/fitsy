import { guidedPreviewResponseSchema, type GuidedPreviewResponse } from '../../../packages/shared/src/contracts/restaurants';
import { api } from './api';
import { getMacroTargets, type StoredMacroTargets } from './macroStorage';

export async function fetchGuidedPreview(area: { lat: number; lng: number }, craving = '', suppliedTargets?: StoredMacroTargets | null): Promise<GuidedPreviewResponse> {
  const targets = suppliedTargets === undefined ? await getMacroTargets() : suppliedTargets;
  const params = new URLSearchParams({ guided: '1', lat: String(area.lat), lng: String(area.lng), q: craving });
  if (targets) for (const [key, value] of Object.entries(targets)) if (value) params.set(key, value);
  return guidedPreviewResponseSchema.parse(await api.get(`/api/restaurants/preview?${params}`));
}
