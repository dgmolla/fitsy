import type { ShuffleResponse } from '@fitsy/shared';
import { shuffleResponseSchema } from '../../../packages/shared/src/contracts/shuffle';
import type { MacroValues } from './macroPresets';
import { api } from './api';
import { supabase } from './supabase';

export function shuffleTargets(values: MacroValues): Partial<Record<keyof MacroValues, number>> {
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => {
    const number = Number(value);
    return value.trim() !== '' && Number.isFinite(number) && number >= 0 ? [[key, number]] : [];
  }));
}

export async function fetchShuffle(
  params: { lat: number; lng: number; targets: ReturnType<typeof shuffleTargets>; seed: string; excludeRecent: string[] },
  signal: AbortSignal,
): Promise<ShuffleResponse> {
  const query = new URLSearchParams({ lat: String(params.lat), lng: String(params.lng), seed: params.seed });
  for (const [key, value] of Object.entries(params.targets)) query.set(key, String(value));
  if (params.excludeRecent.length) query.set('excludeRecent', params.excludeRecent.join(','));
  const before = await supabase.auth.getSession();
  const userId = before.data.session?.user.id;
  const body = await api.get<unknown>(`/api/restaurants/shuffle?${query}`, true, { signal }, userId);
  const after = await supabase.auth.getSession();
  if (after.data.session?.user.id !== userId) throw new Error('Account changed during Shuffle');
  return shuffleResponseSchema.parse(body);
}
