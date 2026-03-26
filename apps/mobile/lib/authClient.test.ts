/**
 * @jest-environment node
 */
import { loginAndStore, registerAndStore } from './authClient';
import type { AuthApiResponse } from '@fitsy/shared';

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const AsyncStorage = (jest.requireMock('@react-native-async-storage/async-storage') as { default: { setItem: jest.Mock } }).default;

function makeMockFetch(options: { ok: boolean; status?: number; body?: unknown }) {
  return jest.fn().mockResolvedValue({
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 400),
    json: jest.fn().mockResolvedValue(options.body ?? {}),
  });
}

const sampleAuthResponse: AuthApiResponse = {
  token: 'jwt-token-abc',
  user: { id: 'u1', email: 'jane@example.com', name: 'Jane' },
};

const errorResponse: AuthApiResponse = {
  error: 'Invalid credentials',
};

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

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'fitsy:authToken',
      'jwt-token-abc',
    );
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

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'fitsy:authToken',
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
