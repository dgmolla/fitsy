import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { AppleAuthResponse, AuthApiResponse, AuthResponse } from '@fitsy/shared';

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

// ─── Apple Sign In ────────────────────────────────────────────────────────────

export async function appleSignIn(): Promise<AppleAuthResponse> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  const { identityToken, authorizationCode, fullName, email } = credential;

  if (!identityToken || !authorizationCode) {
    throw new Error('Apple Sign In failed: missing credentials');
  }

  const result = await postJson<AppleAuthResponse>('/api/auth/apple', {
    identityToken,
    authorizationCode,
    fullName: fullName
      ? {
          givenName: fullName.givenName ?? undefined,
          familyName: fullName.familyName ?? undefined,
        }
      : undefined,
    email: email ?? undefined,
  });

  await storeToken(result.token);
  return result;
}

// ─── Google Sign In ───────────────────────────────────────────────────────────

export interface GoogleAuthResponse {
  token: string;
  user: { id: string; email: string; name: string | null };
  isNewUser: boolean;
}

/**
 * Exchange a Google ID token (obtained via expo-auth-session) for a Fitsy JWT.
 * Call this after the OAuth browser flow completes successfully.
 */
export async function completeGoogleSignIn(idToken: string): Promise<GoogleAuthResponse> {
  const result = await postJson<GoogleAuthResponse>('/api/auth/google', { idToken });
  await storeToken(result.token);
  return result;
}

// ─── Profile + Subscription ───────────────────────────────────────────────────

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
