import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { supabase } from './supabase';

const KEY = '@fitsy/paywallIntent';
const schema = z.object({
  restaurantId: z.string().min(1).optional(),
  menuItemId: z.string().min(1).optional(),
  mealName: z.string().optional(),
  action: z.enum(['menu', 'save', 'discovery']),
  nearbyDishCount: z.number().int().nonnegative().optional(),
  areaName: z.string().optional(),
  query: z.string().max(100).optional(),
});
export type PaywallIntent = z.infer<typeof schema>;
const recordSchema = z.object({ intent: schema, userId: z.string().nullable(), createdAt: z.number().finite() });
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
let pendingWrite: Promise<void> = Promise.resolve();
function writeIntent(work: () => Promise<void>): Promise<void> {
  const next = pendingWrite.then(work, work);
  pendingWrite = next.catch(() => undefined);
  return next;
}
async function readIntentRecord() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const record = recordSchema.parse(JSON.parse(raw));
    const age = Date.now() - record.createdAt;
    return age >= 0 && age < MAX_AGE_MS ? record : null;
  } catch { return null; }
}
export async function rememberPaywallIntent(intent: PaywallIntent): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const record = { intent: schema.parse(intent), userId: data.session?.user.id ?? null, createdAt: Date.now() };
  await writeIntent(() => AsyncStorage.setItem(KEY, JSON.stringify(record)));
}
export async function getPaywallIntent(): Promise<PaywallIntent | null> {
  try {
    await pendingWrite;
    const [record, { data }] = await Promise.all([readIntentRecord(), supabase.auth.getSession()]);
    return record && record.userId === (data.session?.user.id ?? null) ? record.intent : null;
  } catch { return null; }
}
/** Only an explicit sign-in continuation can attach an anonymous selection. */
export async function claimPaywallIntent(userId: string): Promise<void> {
  await writeIntent(async () => {
    const record = await readIntentRecord();
    if (!record || (record.userId !== null && record.userId !== userId)) {
      await AsyncStorage.removeItem(KEY);
      return;
    }
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...record, userId }));
  });
}
export async function clearPaywallIntent(): Promise<void> { await writeIntent(() => AsyncStorage.removeItem(KEY)); }
