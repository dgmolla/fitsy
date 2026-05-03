/**
 * Jest mock for `@supabase/supabase-js`.
 *
 * The real client requires `react-native-url-polyfill/auto`, which ships as
 * untranspiled ESM and breaks the ts-jest "lib" project. Tests that need
 * specific behaviour (e.g. `lib/authClient.test.ts`) override this with their
 * own `jest.mock('./supabase', ...)`. This module-level mock just keeps any
 * file that *imports* the SDK transitively (e.g. via `lib/api.ts`) compilable.
 *
 * Returns plain async functions (not jest.fn) so callers' `jest.resetAllMocks()`
 * doesn't strip the resolved values out from under them.
 */
export const createClient = () => ({
  auth: {
    setSession: async () => ({ data: {}, error: null }),
    getSession: async () => ({ data: { session: null } }),
    signOut: async () => ({ error: null }),
    startAutoRefresh: () => undefined,
    stopAutoRefresh: () => undefined,
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => undefined } },
    }),
  },
});
