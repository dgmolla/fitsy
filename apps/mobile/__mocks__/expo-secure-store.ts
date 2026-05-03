/**
 * Jest mock for `expo-secure-store`.
 *
 * The real module ships untranspiled ESM in `build/SecureStore.js`, which
 * breaks the ts-jest "lib" project. Tests that need specific behaviour
 * (e.g. `lib/authClient.test.ts`) override this with their own
 * `jest.mock('expo-secure-store', ...)`. This module-level mock keeps any
 * file that *imports* SecureStore transitively (e.g. via `lib/supabase.ts`,
 * `lib/authClient.ts`) compilable.
 *
 * Plain async functions (not jest.fn) so other suites' `jest.resetAllMocks()`
 * doesn't blow away the resolved values.
 */
export const getItemAsync = async (_key: string): Promise<string | null> => null;
export const setItemAsync = async (_key: string, _value: string): Promise<void> => {};
export const deleteItemAsync = async (_key: string): Promise<void> => {};
