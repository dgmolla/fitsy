import { router } from 'expo-router';
import { supabase } from './supabase';
import { clearToken } from './authClient';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Source the access token from the Supabase SDK rather than the legacy
 * SecureStore key. The SDK proactively refreshes ~5 min before expiry and
 * `getSession()` returns the current (possibly just-refreshed) access token.
 */
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function handleUnauthorized(): Promise<never> {
  // Sign out clears the Supabase session blob in SecureStore. clearToken also
  // wipes the legacy fitsy_authToken key for users mid-upgrade.
  await clearToken();
  router.replace('/welcome/problem');
  throw new Error('Session expired');
}

async function get<T>(path: string, authenticated = false): Promise<T> {
  const headers: Record<string, string> = {};

  if (authenticated) {
    const token = await getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const init: RequestInit =
    Object.keys(headers).length > 0 ? { headers } : {};

  const res = await fetch(`${BASE_URL}${path}`, init);

  if (res.status === 401 && authenticated) {
    return handleUnauthorized();
  }

  if (res.status === 402 && authenticated) {
    // Subscription not yet synced server-side — the brief window between a
    // successful purchase and the RevenueCat webhook landing. Retry once.
    // (Non-subscribers don't reach authed data routes: the (tabs) guard
    // redirects them to the paywall first.)
    await new Promise((r) => setTimeout(r, 1500));
    const retry = await fetch(`${BASE_URL}${path}`, init);
    if (retry.ok) return retry.json() as Promise<T>;
    const body = (await retry.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'subscription_required');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, authenticated = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authenticated) {
    const token = await getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401 && authenticated) {
    return handleUnauthorized();
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(errBody.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function del(path: string, authenticated = true): Promise<void> {
  const headers: Record<string, string> = {};

  if (authenticated) {
    const token = await getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers,
  });

  if (res.status === 401 && authenticated) {
    return handleUnauthorized() as Promise<never>;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(errBody.error ?? `Request failed: ${res.status}`);
  }
  // 204 No Content — nothing to parse
}

async function patch<T>(path: string, body: unknown, authenticated = true): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authenticated) {
    const token = await getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401 && authenticated) {
    return handleUnauthorized();
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(errBody.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = { get, post, patch, del };
