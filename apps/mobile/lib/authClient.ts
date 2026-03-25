import * as SecureStore from 'expo-secure-store';
import type { AuthApiResponse, AuthResponse } from '@fitsy/shared';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'fitsy:authToken';

// ─── Token storage ────────────────────────────────────────────────────────────

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ─── Auth API calls ───────────────────────────────────────────────────────────

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export async function login(
  email: string,
  password: string,
): Promise<AuthApiResponse> {
  return postJson<AuthApiResponse>('/api/auth/login', { email, password });
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthApiResponse> {
  return postJson<AuthApiResponse>('/api/auth/register', { name, email, password });
}

export async function loginAndStore(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const result = await login(email, password);
  if ('error' in result) {
    throw new Error(result.error);
  }
  await storeToken(result.token);
  return result;
}

export async function registerAndStore(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const result = await register(name, email, password);
  if ('error' in result) {
    throw new Error(result.error);
  }
  await storeToken(result.token);
  return result;
}
