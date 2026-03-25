/**
 * @jest-environment node
 */
import { loginAndStore, registerAndStore } from './authClient';
import type { AuthApiResponse } from '@fitsy/shared';

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const SecureStore = jest.requireMock('expo-secure-store') as {
  setItemAsync: jest.Mock;
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

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'fitsy:authToken',
      'jwt-token-abc',
    );
  });

  it('throws on API error shape', async () => {
    global.fetch = makeMockFetch({ ok: true, body: errorResponse });

    await expect(loginAndStore('bad@example.com', 'wrong')).rejects.toThrow(
      'Invalid credentials',
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
      'fitsy:authToken',
      'jwt-token-abc',
    );
  });

  it('throws on API error shape', async () => {
    global.fetch = makeMockFetch({
      ok: true,
      body: { error: 'Email already in use' } satisfies AuthApiResponse,
    });

    await expect(
      registerAndStore('Jane', 'existing@example.com', 'secret'),
    ).rejects.toThrow('Email already in use');
  });
});
