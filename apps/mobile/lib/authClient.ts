import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type {
  AppleAuthResponse,
  AuthApiResponse,
  AuthResponse,
  GoogleAuthResponse,
} from '@fitsy/shared';
import { supabase } from './supabase';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
// SecureStore keys must contain only alphanumeric, '.', '-', '_' (no ':')
//
// Legacy key — used pre-S-228 to store ONLY the access token. We still write
// to it on auth success so older callers (api.ts, profileSync.ts, profile.tsx)
// continue to function until they migrate to `supabase.auth.getSession()`.
// Refresh logic does NOT depend on this key — Supabase persists the full
// session blob (access + refresh tokens) under its own key via the SecureStore
// adapter in lib/supabase.ts.
const TOKEN_KEY = 'fitsy_authToken';

// ─── Token storage ────────────────────────────────────────────────────────────

/**
 * Returns the current access token from the Supabase session.
 * Falls back to the legacy SecureStore key if the SDK has no session — covers
 * the upgrade window where users had a token stored before S-228 shipped.
 */
export async function getStoredToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  // Legacy fallback: pre-S-228 token still in SecureStore.
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Clear all auth state — Supabase session AND legacy token. Used by logout,
 * account deletion, and the 401 unauthorized handler in api.ts.
 */
export async function clearToken(): Promise<void> {
  // Supabase's signOut clears its own SecureStore key (the session blob).
  await supabase.auth.signOut().catch(() => {
    // signOut may fail offline — don't let that block local cleanup.
  });
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/**
 * Hand a server-issued session over to the Supabase SDK so it can take over
 * proactive refresh (~5 min before expiry), refresh-token rotation, and
 * reuse detection. Called after every successful auth response.
 */
export async function adoptSession(token: string, refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) {
    throw new Error('auth response missing refreshToken');
  }
  await supabase.auth.setSession({
    access_token: token,
    refresh_token: refreshToken,
  });
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
  await adoptSession(result.token, result.refreshToken);
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
  await adoptSession(result.token, result.refreshToken);
  return result;
}

// ─── Dev login ──────────────────────────────────────────────────────────────
// Dev-only throwaway account so onboarding/auth can be exercised without
// Apple/Google OAuth (which need real config + a signed build). Logs in, or
// registers on first run, then stores the token + adopts the session. Shared by
// app/auth/login.tsx and app/welcome/signin.tsx — callers handle nav/analytics.
export async function devLogin(): Promise<AuthResponse> {
  const creds = { email: 'dev@fitsy.local', password: 'dev12345' };
  const attempt = async (path: string) => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    return res.json() as Promise<Partial<AuthResponse> & { error?: string }>;
  };
  let data = await attempt('/api/auth/login');
  if (!data.token) data = await attempt('/api/auth/register');
  if (!data.token || !data.refreshToken || !data.user) {
    throw new Error(data.error ?? 'Dev login failed');
  }
  await storeToken(data.token);
  await adoptSession(data.token, data.refreshToken);
  return data as AuthResponse;
}

// ─── Apple Sign In ────────────────────────────────────────────────────────────

async function generateNonce(): Promise<{ rawNonce: string; hashedNonce: string }> {
  const rawNonce = Crypto.randomUUID().replace(/-/g, '') + Crypto.randomUUID().replace(/-/g, '');
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );
  return { rawNonce, hashedNonce };
}

export async function appleSignIn(): Promise<AppleAuthResponse> {
  const { rawNonce, hashedNonce } = await generateNonce();

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  const { identityToken, authorizationCode, fullName, email } = credential;

  if (!identityToken || !authorizationCode) {
    throw new Error('Apple Sign In failed: missing credentials');
  }

  const result = await postJson<AppleAuthResponse>('/api/auth/apple', {
    identityToken,
    authorizationCode,
    nonce: rawNonce,
    fullName: fullName
      ? {
          givenName: fullName.givenName ?? undefined,
          familyName: fullName.familyName ?? undefined,
        }
      : undefined,
    email: email ?? undefined,
  });

  await storeToken(result.token);
  await adoptSession(result.token, result.refreshToken);
  return result;
}

// ─── Google Sign In ───────────────────────────────────────────────────────────

// Re-export the canonical type from @fitsy/shared. We previously had a local
// declaration here that diverged from the server response shape.
export type { GoogleAuthResponse };

/**
 * Exchange a Google ID token (obtained via expo-auth-session) for a Fitsy JWT.
 * Call this after the OAuth browser flow completes successfully.
 */
export async function completeGoogleSignIn(idToken: string): Promise<GoogleAuthResponse> {
  const result = await postJson<GoogleAuthResponse>('/api/auth/google', { idToken });
  await storeToken(result.token);
  await adoptSession(result.token, result.refreshToken);
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
