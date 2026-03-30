import { getStoredToken, clearToken } from './authClient';
import { router } from 'expo-router';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

async function handleUnauthorized(): Promise<never> {
  await clearToken();
  router.replace('/welcome');
  throw new Error('Session expired');
}

async function get<T>(path: string, authenticated = false): Promise<T> {
  const headers: Record<string, string> = {};

  if (authenticated) {
    const token = await getStoredToken();
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
    const token = await getStoredToken();
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
    const token = await getStoredToken();
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
    const token = await getStoredToken();
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
