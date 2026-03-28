import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthApiResponse, AuthResponse } from '@fitsy/shared';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'fitsy:authToken';

// ─── Token storage ────────────────────────────────────────────────────────────

export async function getStoredToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function storeToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

// ─── Auth API calls ───────────────────────────────────────────────────────────

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = (data as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
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

// ─── Stub functions (implemented in later sprints) ────────────────────────────

export interface UserProfileData {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  activityLevel?: string;
  goal?: string;
}

export interface SubscriptionData {
  plan: 'monthly' | 'yearly';
  receiptData?: string;
}

export async function appleSignIn(): Promise<never> {
  throw new Error('not implemented');
}

export async function updateProfile(data: UserProfileData): Promise<void> {
  const token = await getStoredToken();
  const res = await fetch(`${BASE_URL}/api/user/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
}

export async function verifySubscription(data: SubscriptionData): Promise<void> {
  const token = await getStoredToken();
  const res = await fetch(`${BASE_URL}/api/subscriptions/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
}
