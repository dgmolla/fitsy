import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { supabase } from './supabase';

const KEY = '@fitsy/paywallIntent';
const PURCHASED_KEY = '@fitsy/purchasedContinuation';
const schema = z.object({
  restaurantId: z.string().min(1).optional(),
  menuItemId: z.string().min(1).optional(),
  mealName: z.string().optional(),
  restaurantName: z.string().max(300).optional(),
  photoUrl: z.string().url().optional(),
  nearbyRestaurants: z.array(z.object({ id: z.string(), name: z.string().max(300), photoUrl: z.string().url().optional() })).max(3).optional(),
  area: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  targets: z.object({ calories: z.string(), protein: z.string(), carbs: z.string(), fat: z.string() }).optional(),
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
async function readIntentRecord(key = KEY) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const record = recordSchema.parse(JSON.parse(raw));
    const age = Date.now() - record.createdAt;
    return age >= 0 && age < MAX_AGE_MS ? record : null;
  } catch { return null; }
}
export async function rememberPaywallIntent(intent: PaywallIntent): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const record = { intent: schema.parse(intent), userId: data.session?.user.id ?? null, createdAt: Date.now() };
  await writeIntent(async () => {
    await AsyncStorage.removeItem(PURCHASED_KEY);
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  });
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
      await AsyncStorage.removeItem(PURCHASED_KEY);
      return;
    }
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...record, userId }));
  });
}
/** Snapshot only an owned selection after entitlement has completed onboarding. */
export async function markPurchasedContinuation(): Promise<void> {
  await writeIntent(async () => {
    const [record, { data }] = await Promise.all([readIntentRecord(), supabase.auth.getSession()]);
    if (record?.userId && record.userId === data.session?.user.id) {
      await AsyncStorage.setItem(PURCHASED_KEY, JSON.stringify(record));
    } else await AsyncStorage.removeItem(PURCHASED_KEY);
  });
}

/** Call only after the signed-in account's entitlement has settled true. */
export async function getPurchasedContinuation(): Promise<PaywallIntent | null> {
  await pendingWrite;
  const [record, { data }] = await Promise.all([readIntentRecord(PURCHASED_KEY), supabase.auth.getSession()]);
  return record?.userId && record.userId === data.session?.user.id ? record.intent : null;
}

export async function clearPaywallIntent(): Promise<void> {
  await writeIntent(async () => { await AsyncStorage.removeItem(KEY); await AsyncStorage.removeItem(PURCHASED_KEY); });
}
