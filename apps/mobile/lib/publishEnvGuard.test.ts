// The guard lives in app.config.ts (see the comment there for why it is not a
// lib module). Importing the config in a test is safe: NODE_ENV is 'test', so
// the module-level assertPublishEnv(process.env) call is a no-op.
import {
  PUBLISH_ENV_OVERRIDE_VAR as OVERRIDE_VAR,
  REQUIRED_PUBLIC_ENV,
  assertPublishEnv,
  assertPublicEnvSafety,
  missingPublicEnv,
  shouldEnforcePublishEnv,
} from '../app.config';

const full: Record<string, string> = Object.fromEntries(
  REQUIRED_PUBLIC_ENV.map((name) => [name, `${name.toLowerCase()}-value`]),
);

describe('missingPublicEnv', () => {
  it('returns nothing when every required var is set', () => {
    expect(missingPublicEnv(full)).toEqual([]);
  });

  it('lists unset and blank vars', () => {
    const env = { ...full, EXPO_PUBLIC_REVENUECAT_IOS_KEY: '   ', EXPO_PUBLIC_API_URL: undefined };
    expect(missingPublicEnv(env)).toEqual(['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_REVENUECAT_IOS_KEY']);
  });
});

test.each([
  { EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'fixture' },
  { EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_fixture' },
  { EXPO_PUBLIC_REVENUECAT_IOS_KEY: ['sk', 'live', 'fixture'].join('_') },
  { EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'fixture-password', NODE_ENV: 'production' },
  { EXPO_PUBLIC_SUPABASE_ANON_KEY: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.fixture` },
])('rejects private public env even when presence enforcement is bypassed: %j', env => {
  expect(() => assertPublishEnv({ ...env, EAS_BUILD: 'true', [OVERRIDE_VAR]: '1' })).toThrow(/Refusing to bundle secret/);
});

test('public Supabase/SDK keys and isolated Debug fixtures remain usable', () => {
  expect(() => assertPublicEnvSafety({ NODE_ENV: 'development', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
    EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'fixture-only', EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_fixture' })).not.toThrow();
});

describe('shouldEnforcePublishEnv', () => {
  it('enforces on a production export outside EAS Build', () => {
    expect(shouldEnforcePublishEnv({ NODE_ENV: 'production' })).toBe(true);
  });

  it('skips local development and test runs', () => {
    expect(shouldEnforcePublishEnv({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldEnforcePublishEnv({ NODE_ENV: 'test' })).toBe(false);
    expect(shouldEnforcePublishEnv({})).toBe(false);
  });

  it('skips EAS Build workers (env is injected per build profile there)', () => {
    expect(shouldEnforcePublishEnv({ NODE_ENV: 'production', EAS_BUILD: 'true' })).toBe(false);
  });

  it('honours the explicit override', () => {
    expect(shouldEnforcePublishEnv({ NODE_ENV: 'production', [OVERRIDE_VAR]: '1' })).toBe(false);
    expect(shouldEnforcePublishEnv({ NODE_ENV: 'production', [OVERRIDE_VAR]: '0' })).toBe(true);
  });
});

describe('assertPublishEnv', () => {
  it('passes a fully configured production export', () => {
    expect(() => assertPublishEnv({ NODE_ENV: 'production', ...full })).not.toThrow();
  });

  it('throws naming the missing vars and the fix', () => {
    const env = { NODE_ENV: 'production', ...full, EXPO_PUBLIC_REVENUECAT_IOS_KEY: undefined };
    expect(() => assertPublishEnv(env)).toThrow(/EXPO_PUBLIC_REVENUECAT_IOS_KEY/);
    expect(() => assertPublishEnv(env)).toThrow(/--environment production/);
  });

  it('is a no-op for the bare-env shape that bit production (dev mode)', () => {
    // Same empty env, but not a production export: `expo start` must keep working.
    expect(() => assertPublishEnv({ NODE_ENV: 'development' })).not.toThrow();
  });
});
