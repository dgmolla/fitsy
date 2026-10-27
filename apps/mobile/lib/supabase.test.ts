/**
 * @jest-environment node
 *
 * Unit tests for the SecureStore adapter that backs the Supabase RN client.
 * The real Supabase SDK is mocked at the module-name-mapper level
 * (see __mocks__/supabase-js.ts), so these tests exercise the adapter's
 * contract with `expo-secure-store` directly — that's the only piece of
 * supabase.ts not stubbed out in the test environment.
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

import * as SecureStore from 'expo-secure-store';
import { secureStoreAdapter, supabase } from './supabase';
import { authFetch } from '@fitsy/shared/utils/authTransport';

const mockedGet = SecureStore.getItemAsync as jest.Mock;
const mockedSet = SecureStore.setItemAsync as jest.Mock;
const mockedDel = SecureStore.deleteItemAsync as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  mockedSet.mockResolvedValue(undefined);
  mockedDel.mockResolvedValue(undefined);
});

describe('secureStoreAdapter', () => {
  it('getItem reads from SecureStore.getItemAsync and returns the stored value', async () => {
    mockedGet.mockResolvedValue('{"access_token":"abc","refresh_token":"xyz"}');

    const value = await secureStoreAdapter.getItem('sb-session-key');

    expect(mockedGet).toHaveBeenCalledWith('sb-session-key');
    expect(value).toBe('{"access_token":"abc","refresh_token":"xyz"}');
  });

  it('getItem returns null when nothing is stored', async () => {
    mockedGet.mockResolvedValue(null);

    const value = await secureStoreAdapter.getItem('sb-session-key');

    expect(value).toBeNull();
  });

  it('setItem persists via SecureStore.setItemAsync (this is how setSession() writes)', async () => {
    await secureStoreAdapter.setItem('sb-session-key', '{"access_token":"abc"}');

    expect(mockedSet).toHaveBeenCalledWith('sb-session-key', '{"access_token":"abc"}');
  });

  it('removeItem clears via SecureStore.deleteItemAsync (this is how signOut() wipes)', async () => {
    await secureStoreAdapter.removeItem('sb-session-key');

    expect(mockedDel).toHaveBeenCalledWith('sb-session-key');
  });
});

describe('supabase client', () => {
  it('exposes the auth surface the rest of the app calls', () => {
    // Smoke test: if any of these go missing, the module-level mock or the
    // real SDK contract has drifted and we want to know fast.
    expect(typeof supabase.auth.getSession).toBe('function');
    expect(typeof supabase.auth.setSession).toBe('function');
    expect(typeof supabase.auth.signOut).toBe('function');
    expect(typeof supabase.auth.startAutoRefresh).toBe('function');
    expect(typeof supabase.auth.stopAutoRefresh).toBe('function');
    expect(typeof supabase.auth.onAuthStateChange).toBe('function');
  });

  it('installs the safe transport in the actual mobile client factory', async () => {
    let configuredFetch: typeof fetch | undefined;
    jest.isolateModules(() => {
      const sdk = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
      const create = jest.spyOn(sdk, 'createClient');
      require('./supabase');
      const options = create.mock.calls[0]![2]!;
      configuredFetch = options.global?.fetch;
      create.mockRestore();
    });
    const transport = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('PRIVATE_SENTINEL_575'));
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const response = await configuredFetch!('https://auth.example.test/auth/v1/token');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: 'Authentication provider unavailable' });
    expect(warn.mock.calls).toEqual([['[auth] provider_unavailable']]);
    transport.mockRestore();
    warn.mockRestore();
  });

  it('keeps transport failure details out of SDK logs without invalidating a session', async () => {
    const transport = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('PRIVATE_SENTINEL_575 refresh token'));
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const response = await authFetch('https://auth.example.test/auth/v1/token');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: 'Authentication provider unavailable' });
    expect(warn.mock.calls).toEqual([['[auth] provider_unavailable']]);
    transport.mockRestore();
    warn.mockRestore();
  });

  it.each(['session_not_found', 'weak_password', 'PRIVATE_SENTINEL_575'])( // gitleaks:allow - Synthetic error-code sentinel, not a credential.
    'normalizes provider error bodies and preserves required SDK classifications (%s)', async code => {
      const transport = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        message: 'PRIVATE_SENTINEL_575 account details', code,
        weak_password: { reasons: ['PRIVATE_SENTINEL_575'] },
      }), { status: 400 }));
      const response = await authFetch('https://auth.example.test/auth/v1/token');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: 'Authentication provider rejected request',
        ...(code === 'PRIVATE_SENTINEL_575' ? {} : { error_code: code }) });
      transport.mockRestore();
    },
  );

  it('forwards successful auth responses and request options unchanged', async () => {
    const response = new Response('{"access_token":"fixture-token"}');
    const transport = jest.spyOn(global, 'fetch').mockResolvedValue(response);
    const options = { method: 'POST', body: '{"refresh_token":"fixture-refresh"}' };
    expect(await authFetch('https://auth.example.test/auth/v1/token', options)).toBe(response);
    expect(transport).toHaveBeenCalledWith('https://auth.example.test/auth/v1/token', options);
    transport.mockRestore();
  });
});
