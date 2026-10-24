/**
 * @jest-environment node
 */
import { adoptSession, appleSignIn, clearToken, completeGoogleSignIn, devLogin, loginAndStore, registerAndStore } from './authClient';
import type { AuthApiResponse } from '@fitsy/shared';
import * as AppleAuthentication from 'expo-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock Supabase client — adoptSession() calls supabase.auth.setSession()
// after every auth response (S-228). The real client requires native polyfills
// and would flake in node test env, so stub it here with the minimum surface.
jest.mock('./supabase', () => ({
  supabase: {
    auth: {
      setSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'jwt-token-abc', user: { id: 'u1' } } }, error: null }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

const SecureStore = jest.requireMock('expo-secure-store') as {
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};
const SupabaseMock = jest.requireMock('./supabase') as {
  supabase: { auth: { setSession: jest.Mock } };
};

function makeMockFetch(options: { ok: boolean; status?: number; body?: unknown }) {
  return jest.fn().mockResolvedValue({
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 400),
    json: jest.fn().mockResolvedValue(options.body ?? {}),
  });
}

const sampleAuthResponse: AuthApiResponse = {
  token: 'jwt-token-abc',
  refreshToken: 'refresh-token-xyz',
  user: { id: 'u1', email: 'jane@example.com', name: 'Jane' },
};

const errorResponse: AuthApiResponse = {
  error: 'Invalid credentials',
};

describe('confirmed session adoption', () => {
  const originalFetch = global.fetch;
  const originalDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
    global.fetch = makeMockFetch({ ok: true, body: sampleAuthResponse });
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: 'apple-token', authorizationCode: 'apple-code',
    } as AppleAuthentication.AppleAuthenticationCredential);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
    if (originalDev) Object.defineProperty(globalThis, '__DEV__', originalDev);
    else Reflect.deleteProperty(globalThis, '__DEV__');
  });

  it.each([
    ['Apple', () => appleSignIn()],
    ['Google', () => completeGoogleSignIn('google-token')],
    ['development', () => devLogin()],
    ['email login', () => loginAndStore('jane@example.com', 'secret')],
    ['registration', () => registerAndStore('Jane', 'jane@example.com', 'secret')],
  ] as const)('%s rejects an SDK session error without retaining a legacy token', async (_provider, authenticate) => {
    SupabaseMock.supabase.auth.setSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Session rejected') });
    await expect(authenticate()).rejects.toThrow('Session rejected');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('rejects an empty SDK session without retaining a legacy token', async () => {
    SupabaseMock.supabase.auth.setSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(adoptSession('jwt-token-abc', 'refresh-token-xyz')).rejects.toThrow('session');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('rejects a missing Google ID token without exchanging or storing credentials', async () => {
    await expect(completeGoogleSignIn('')).rejects.toThrow('missing credentials');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(SupabaseMock.supabase.auth.setSession).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('retains the confirmed access token when the SDK refreshes during adoption', async () => {
    SupabaseMock.supabase.auth.setSession.mockResolvedValueOnce({
      data: { session: { access_token: 'refreshed-token', user: { id: 'u1' } } }, error: null,
    });
    await loginAndStore('jane@example.com', 'secret');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('fitsy_authToken', 'refreshed-token');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith('fitsy_authToken', 'jwt-token-abc');
  });

  it('refuses development authentication in production before sending credentials', async () => {
    Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
    await expect(devLogin()).rejects.toThrow('development');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(SupabaseMock.supabase.auth.setSession).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it.each(['logout', 'session-expired'] as const)('%s clears tokens and only explicit logout abandons checkout', async reason => {
    const keys = ['@fitsy/paywallIntent', '@fitsy/purchasedContinuation', '@fitsy/paymentSignInContinuation', '@fitsy/pendingMealClaim'];
    for (const key of keys) await AsyncStorage.setItem(key, 'retained-checkout');
    await clearToken(reason);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('fitsy_authToken');
    for (const key of keys) expect(await AsyncStorage.getItem(key)).toBe(reason === 'logout' ? null : 'retained-checkout');
  });
});

describe('loginAndStore', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('calls POST /api/auth/login with correct body', async () => {
    global.fetch = makeMockFetch({ ok: true, body: sampleAuthResponse });

    await loginAndStore('jane@example.com', 'secret');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'jane@example.com',
      password: 'secret',
    });
  });

  it('stores the token on success', async () => {
    global.fetch = makeMockFetch({ ok: true, body: sampleAuthResponse });

    await loginAndStore('jane@example.com', 'secret');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'fitsy_authToken',
      'jwt-token-abc',
    );
  });

  it('hands the session (access + refresh) to Supabase SDK on success', async () => {
    global.fetch = makeMockFetch({ ok: true, body: sampleAuthResponse });

    await loginAndStore('jane@example.com', 'secret');

    expect(SupabaseMock.supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: 'jwt-token-abc',
      refresh_token: 'refresh-token-xyz',
    });
  });

  it('throws on API error shape (200 with error body)', async () => {
    global.fetch = makeMockFetch({ ok: true, body: errorResponse });

    await expect(loginAndStore('bad@example.com', 'wrong')).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('throws on HTTP error response with error body', async () => {
    global.fetch = makeMockFetch({ ok: false, status: 401, body: { error: 'Invalid credentials' } });

    await expect(loginAndStore('bad@example.com', 'wrong')).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('throws with HTTP status fallback when error body is empty', async () => {
    global.fetch = makeMockFetch({ ok: false, status: 500, body: {} });

    await expect(loginAndStore('jane@example.com', 'secret')).rejects.toThrow(
      'HTTP 500',
    );
  });

  it('throws on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network down'));

    await expect(loginAndStore('jane@example.com', 'secret')).rejects.toThrow(
      'Network down',
    );
  });
});

describe('registerAndStore', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('calls POST /api/auth/register with name, email, password', async () => {
    global.fetch = makeMockFetch({ ok: true, body: sampleAuthResponse });

    await registerAndStore('Jane', 'jane@example.com', 'secret');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/auth/register');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
      password: 'secret',
    });
  });

  it('stores the token on success', async () => {
    global.fetch = makeMockFetch({ ok: true, body: sampleAuthResponse });

    await registerAndStore('Jane', 'jane@example.com', 'secret');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'fitsy_authToken',
      'jwt-token-abc',
    );
  });

  it('throws on API error shape (200 with error body)', async () => {
    global.fetch = makeMockFetch({
      ok: true,
      body: { error: 'Email already in use' } satisfies AuthApiResponse,
    });

    await expect(
      registerAndStore('Jane', 'existing@example.com', 'secret'),
    ).rejects.toThrow('Email already in use');
  });

  it('throws on HTTP error response with error body', async () => {
    global.fetch = makeMockFetch({ ok: false, status: 409, body: { error: 'Email already in use' } });

    await expect(
      registerAndStore('Jane', 'existing@example.com', 'secret'),
    ).rejects.toThrow('Email already in use');
  });
});
