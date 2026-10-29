import { NativeModules, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';
import { getDiscoveryMacroTargets } from './macroStorage';
import { notifyWidgetUpdates } from './widgetEvents';
import { withinMs } from './async';

const origin = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const credentialKey = 'fitsy_widget_credential';
const installationKey = 'fitsy_widget_installation';
const locationKey = (owner: string) => `fitsy_widget_location.${owner}`;
type Bridge = { configure(json: string): Promise<void>; clear(): Promise<void> };
const bridge = (): Bridge | undefined => Platform.OS === 'ios' ? NativeModules?.FitsyWidgetBridge as Bridge | undefined : undefined;
export const widgetAvailable = (): boolean => !!bridge();
type Credential = { owner: string; origin: string; token: string; expiresAt: string };
let generation = 0;
let queue: Promise<void> = Promise.resolve();

async function tokenRequest(method: 'POST' | 'DELETE', installationId: string, accessToken: string): Promise<Credential | null> {
  // React Native's AbortSignal polyfill does not implement AbortSignal.timeout.
  const controller = new AbortController();
  try {
    const operation = async () => {
      const response = await fetch(`${origin}/api/widget/token`, { method,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId }), signal: controller.signal });
      return response.ok ? await response.json() as Credential : null;
    };
    return await withinMs(operation(), method === 'POST' ? 10_000 : 5000);
  } finally { controller.abort(); }
}

async function owner(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.is_anonymous ? null : data.session?.user.id ?? null;
}

/** Capture the last settled search area, without requesting background GPS. */
export async function saveWidgetLocation(lat: number, lng: number): Promise<void> {
  if (!bridge() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  const id = await owner();
  if (!id) return;
  const key = locationKey(id), value = JSON.stringify({ lat, lng });
  if (await SecureStore.getItemAsync(key) === value || await owner() !== id) return;
  await SecureStore.setItemAsync(key, value);
  if (await owner() === id) notifyWidgetUpdates();
}

/** Clear shared dish data immediately. A late fetch cannot repopulate it. */
export async function clearWidget(accessToken?: string): Promise<void> {
  generation++;
  const localClear = bridge()?.clear();
  const installationId = await SecureStore.getItemAsync(installationKey);
  await SecureStore.deleteItemAsync(credentialKey);
  await localClear;
  if (accessToken && installationId) {
    try {
      await tokenRequest('DELETE', installationId, accessToken);
    } catch { /* Offline logout still removes all locally usable widget data. */ }
  }
}

async function performSync(entitled: boolean | null, expectedGeneration: number): Promise<void> {
  const native = bridge();
  if (!native || expectedGeneration !== generation) return;
  const id = await owner();
  if (!id) { await clearWidget(); return; }
  const current = async () => expectedGeneration === generation && await owner() === id;
  let credential: Credential | null = null;
  try { credential = JSON.parse(await SecureStore.getItemAsync(credentialKey) ?? 'null') as Credential | null; }
  catch { /* Replace a corrupt local capability using the authenticated app. */ }
  if (!credential || credential.owner !== id || credential.origin !== origin ||
      !/^[a-f0-9]{64}$/.test(credential.token) || !Number.isFinite(Date.parse(credential.expiresAt))) {
    await native.clear();
    credential = null;
  }
  if (credential && Date.parse(credential.expiresAt) <= Date.now()) {
    await native.clear();
    credential = null;
  }
  if (!credential || Date.parse(credential.expiresAt) - Date.now() < 7 * 86_400_000) {
    let installationId = await SecureStore.getItemAsync(installationKey);
    if (!installationId) {
      installationId = Crypto.randomUUID();
      await SecureStore.setItemAsync(installationKey, installationId);
    }
    const { data } = await supabase.auth.getSession();
    if (!await current() || !data.session?.access_token) return;
    const result = await tokenRequest('POST', installationId, data.session.access_token);
    if (!result) return;
    if (!/^[a-f0-9]{64}$/.test(result.token) || !Number.isFinite(Date.parse(result.expiresAt)) || !await current()) return;
    credential = { ...result, owner: id, origin };
    await SecureStore.setItemAsync(credentialKey, JSON.stringify(credential));
  }
  const targets = await getDiscoveryMacroTargets();
  const rawLocation = await SecureStore.getItemAsync(locationKey(id));
  const query: Record<string, string> = {};
  if (rawLocation) {
    try {
      const location = JSON.parse(rawLocation) as { lat: number; lng: number };
      if (Number.isFinite(location.lat) && Number.isFinite(location.lng) && Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180) {
        query.lat = String(location.lat); query.lng = String(location.lng);
      }
    } catch { /* The widget asks the user to open Search for a valid area. */ }
  }
  for (const key of ['protein', 'carbs', 'fat', 'calories'] as const) {
    const value = Number.parseFloat(targets?.[key] ?? '');
    if (Number.isFinite(value) && value >= 0) query[key] = String(value);
  }
  if (!await current()) return;
  await native.configure(JSON.stringify({ owner: id, token: credential.token,
    expiresAt: Date.parse(credential.expiresAt) / 1000, baseURL: origin, query, locked: entitled === false }));
  // Native IO may complete after sign-out. Keep clearing ahead of stale writes.
  if (!await current()) await native.clear();
}

export function syncWidget(entitled: boolean | null): Promise<void> {
  const expectedGeneration = generation;
  const next = queue.then(() => performSync(entitled, expectedGeneration));
  queue = next.catch(() => undefined);
  return next;
}
