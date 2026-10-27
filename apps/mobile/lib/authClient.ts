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
import { clearPaywallIntent } from './paywallIntent';
import { clearPaymentSignInContinuation } from './paymentSignInContinuation';
import { clearPendingMealClaim } from './pendingMealClaim';
import { archiveActiveMacroTargets, clearActiveMacroTargets } from './macroStorage';
import { clearAccountOnboardingData } from './onboardingStorage';
import { forgetPendingProfileSync } from './profileSyncStorage';
import { clearDiscoverySignIn } from './discoverySignIn';

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
 * Expiry retains account-bound checkout for reauthentication; explicit logout
 * abandons it before the SDK emits SIGNED_OUT.
 */
export async function clearToken({ reason = 'logout', forgetTargets = false }: {
  reason?: 'logout' | 'session-expired';
  forgetTargets?: boolean;
} = {}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (forgetTargets && data.session?.user?.id) await forgetPendingProfileSync(data.session.user.id);
  await archiveActiveMacroTargets(data.session?.user?.id ?? null, forgetTargets);
  await clearAccountOnboardingData(data.session?.user?.id ?? null, forgetTargets);
  if (reason === 'logout') await Promise.allSettled([
    clearPaywallIntent(), clearPaymentSignInContinuation(), clearPendingMealClaim(), clearDiscoverySignIn(),
  ]);
  // Supabase's signOut clears its own SecureStore key (the session blob).
  await supabase.auth.signOut().catch(() => {
    // signOut may fail offline — don't let that block local cleanup.
  });
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await clearActiveMacroTargets(data.session?.user?.id ?? null);
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
  const { data, error } = await supabase.auth.setSession({
    access_token: token,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  if (!data.session?.access_token || !data.session.user?.id) {
    throw new Error('Sign in did not establish a session. Please try again.');
  }
  // Never let the legacy fallback turn failed adoption into an authenticated
  // cold resume. Adoption can refresh the token, so retain its confirmed value.
  await storeToken(data.session.access_token);
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
  await adoptSession(result.token, result.refreshToken);
  return result;
}

// ─── Dev login ──────────────────────────────────────────────────────────────
// Dev-only throwaway account so onboarding/auth can be exercised without
// Apple/Google OAuth (which need real config + a signed build). Only the default
// local account registers on first run; configured journey fixtures must exist.
// Both app/auth/login.tsx and app/welcome/signin.tsx own navigation/analytics.
export async function devLogin(): Promise<AuthResponse> {
  if (!__DEV__) throw new Error('Dev login is only available in development.');
  // An isolated Test Store run can use a disposable development account
  // without changing the shared Dev login account or its billing eligibility.
  const email = process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL;
  const password = process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD;
  const configured = !!(email || password);
  if (configured && (!email || !password)) {
    throw new Error('Set both EXPO_PUBLIC_DEV_LOGIN_EMAIL and EXPO_PUBLIC_DEV_LOGIN_PASSWORD for Dev login.');
  }
  const creds = { email: email || 'dev@fitsy.local', password: password || 'dev12345' };
  const attempt = async (path: string) => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    const data = await res.json().catch(() => ({})) as Partial<AuthResponse> & { error?: string };
    return { res, data };
  };
  let result = await attempt('/api/auth/login');
  // Do not turn bad fixture credentials or a service failure into registration.
  // That masked the returning-preview failure as "Email already registered".
  if (!configured && result.res.status === 401 && !result.data.token) result = await attempt('/api/auth/register');
  const { res, data } = result;
  if (!res.ok || !data.token || !data.refreshToken || !data.user) {
    throw new Error(data.error ?? `Dev login failed (HTTP ${res.status})`);
  }
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
  if (!idToken) throw new Error('Google Sign In failed: missing credentials');
  const result = await postJson<GoogleAuthResponse>('/api/auth/google', { idToken });
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

// Entitlement is owned by the server's Subscription row (fed by the
// RevenueCat webhook and by POST /api/subscriptions/sync re-reads). The
// mobile app never POSTs receipts; it reads the verdict from
// GET /api/subscriptions/status and asks for a re-read via /sync (see
// lib/useEntitlementVerdict.ts). Protected data routes use
// optionalSubscription: an unentitled caller gets a locked 200, never a 402.
