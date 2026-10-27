import { flagsSchema } from '../../../packages/shared/src/contracts/flags';
import { api } from './api';

let overrides = new Map<string, boolean>();
let expiresAt = 0;
let pending: Promise<void> | undefined;

/** Pass process.env.EXPO_PUBLIC_FLAG_NAME literally so Expo can inline it. */
export function isFlagEnabled(name: string, bundledValue?: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name) &&
    ((Date.now() < expiresAt ? overrides.get(name) : undefined) ?? bundledValue === 'true');
}

/** Optional: await before evaluating flags on entry/foreground; cache and coalesce reads. */
export async function refreshFlags(): Promise<void> {
  if (Date.now() < expiresAt) return;
  pending ??= loadFlags().finally(() => { pending = undefined; });
  await pending;
}

async function loadFlags(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const body = await api.get<unknown>('/api/flags', true, { signal: controller.signal });
    overrides = new Map(Object.entries(flagsSchema.parse(body)));
  } catch {
    overrides.clear();
  } finally {
    clearTimeout(timeout);
    expiresAt = Date.now() + 60_000;
  }
}
