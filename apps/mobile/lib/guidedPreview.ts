import { guidedPreviewResponseSchema, type GuidedPreviewResponse } from '@fitsy/shared';
import { api } from './api';
import { getMacroTargets } from './macroStorage';

export async function fetchGuidedPreview(area: { lat: number; lng: number }, craving = ''): Promise<GuidedPreviewResponse> {
  const targets = await getMacroTargets();
  const params = new URLSearchParams({ guided: '1', lat: String(area.lat), lng: String(area.lng), q: craving });
  if (targets) for (const [key, value] of Object.entries(targets)) if (value) params.set(key, value);
  return guidedPreviewResponseSchema.parse(await api.get(`/api/restaurants/preview?${params}`));
}
