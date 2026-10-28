import { router } from 'expo-router';
import { supabase } from './supabase';
import { clearToken } from './authClient';
import { hasPaymentSignInContinuation } from './paymentSignInContinuation';
import { discoveryDestinationForApi, requestDiscoverySignIn } from './discoverySignIn';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/**
 * Source the access token from the Supabase SDK rather than the legacy
 * SecureStore key. The SDK proactively refreshes ~5 min before expiry and
 * `getSession()` returns the current (possibly just-refreshed) access token.
 */
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.is_anonymous ? null : data.session?.access_token ?? null;
}

async function handleUnauthorized(path: string): Promise<never> {
  // Sign out clears the Supabase session blob in SecureStore. clearToken also
  // wipes the legacy fitsy_authToken key for users mid-upgrade.
  await clearToken({ reason: 'session-expired' });
  const checkout = await hasPaymentSignInContinuation();
  const destination = discoveryDestinationForApi(path);
  if (!checkout && destination) {
    await requestDiscoverySignIn(destination);
    throw new ApiRequestError(401, 'Session expired');
  }
  router.replace(checkout ? '/welcome/signin?returnTo=payment' : '/welcome/problem');
  throw new ApiRequestError(401, 'Session expired');
}

async function get<T>(path: string, authenticated = true, options: { signal?: AbortSignal } = {},
  expectedUserId?: string): Promise<T> {
  const headers: Record<string, string> = {};
  let requestToken: string | undefined;

  if (authenticated) {
    const { data } = await supabase.auth.getSession();
    if (expectedUserId && data.session?.user.id !== expectedUserId) throw new Error('Account changed before request');
    const token = data.session?.user.is_anonymous ? undefined : data.session?.access_token;
    requestToken = token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const init: RequestInit =
    { headers, signal: options.signal };

  const res = await fetch(`${BASE_URL}${path}`, init);
  if (options.signal?.aborted) throw new Error('Request cancelled');

  if (res.status === 401 && authenticated) {
    if (expectedUserId) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== expectedUserId || data.session?.access_token !== requestToken)
        throw new ApiRequestError(401, 'Previous account request expired');
    }
    return handleUnauthorized(path);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new ApiRequestError(res.status, body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, authenticated = true, expectedUserId?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let requestToken: string | undefined;

  if (authenticated) {
    const { data } = await supabase.auth.getSession();
    if (expectedUserId && data.session?.user.id !== expectedUserId) throw new Error('Account changed before request');
    const token = data.session?.user.is_anonymous ? undefined : data.session?.access_token;
    requestToken = token;
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
    if (expectedUserId) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== expectedUserId || data.session?.access_token !== requestToken) {
        throw new ApiRequestError(401, 'Previous account request expired');
      }
    }
    return handleUnauthorized(path);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    throw new ApiRequestError(res.status, errBody.error ?? `Request failed: ${res.status}`);
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
    return handleUnauthorized(path) as Promise<never>;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(errBody.error ?? `Request failed: ${res.status}`);
  }
  // 204 No Content - nothing to parse
}

async function patch<T>(path: string, body: unknown, authenticated = true, expectedUserId?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let requestToken: string | undefined;

  if (authenticated) {
    const { data } = await supabase.auth.getSession();
    if (expectedUserId && data.session?.user.id !== expectedUserId) throw new Error('Account changed before request');
    const token = data.session?.user.is_anonymous ? undefined : data.session?.access_token;
    requestToken = token;
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
    if (expectedUserId) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== expectedUserId || data.session?.access_token !== requestToken) {
        throw new ApiRequestError(401, 'Previous account request expired');
      }
    }
    return handleUnauthorized(path);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(errBody.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = { get, post, patch, del };
