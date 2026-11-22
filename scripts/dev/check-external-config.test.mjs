import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSettings, diffEnvNames, envNames, check, vercelEnvNames, diffVercelEnv, fetchRevenueCat, diffRevenueCat, revenueCatKey } from './check-external-config.mjs';

test('reports drift in plain words without values', () => {
  const expected = { 'external.anonymous_users': true, disable_signup: false };
  assert.deepEqual(diffSettings(expected, { external: { anonymous_users: false }, disable_signup: false }),
    ['supabase dev auth external.anonymous_users: expected ON, actual OFF']);
  assert.deepEqual(diffSettings(expected, { external: { anonymous_users: true }, disable_signup: false }), []);
  assert.match(diffSettings(expected, {})[0], /actual missing/);
});

test('env names are compared by name only', () => {
  assert.deepEqual([...envNames('A=1\nB="secret"\n# c\n')].sort(), ['A', 'B']);
  assert.deepEqual(diffEnvNames({ f: ['A', 'C'] }, () => new Set(['A'])), ['f C: expected present, actual missing']);
  assert.match(diffEnvNames({ f: ['A'] }, () => null)[0], /actual missing/);
});

test('check reads the public settings endpoint and never echoes the key', async () => {
  const env = { EXPO_PUBLIC_SUPABASE_URL: 'https://example.test', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-secret-value' };
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://example.test/auth/v1/settings');
    assert.equal(init.headers.apikey, 'anon-secret-value');
    return { ok: true, status: 200, json: async () => ({ external: { anonymous_users: false, email: true }, disable_signup: false }) };
  };
  const drift = await check({ env, fetchImpl });
  assert.ok(drift.some(line => line.includes('external.anonymous_users: expected ON, actual OFF')));
  assert.ok(!drift.join('\n').includes('anon-secret-value'));
});

test('an unreachable project is reported as drift, not a crash', async () => {
  const drift = await check({ env: { EXPO_PUBLIC_SUPABASE_URL: 'https://x.test', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'k' },
    fetchImpl: async () => { throw new Error('network down'); } });
  assert.ok(drift.some(line => line.includes('could not read (network down)')));
});

test('vercel env names are parsed from the table and compared per environment without values', () => {
  const table = ' name   value   environments   created\n SENTRY_PROJECT   Encrypted   Production   8d\n UPSTASH_REDIS_REST_URL   Encrypted   Preview   8d\n';
  assert.deepEqual([...vercelEnvNames(table)].sort(), ['SENTRY_PROJECT', 'UPSTASH_REDIS_REST_URL']);
  const required = { production: ['SENTRY_PROJECT', 'CRON_SECRET'], preview: ['UPSTASH_REDIS_REST_URL'] };
  const read = environment => vercelEnvNames(table);
  assert.deepEqual(diffVercelEnv(required, read), ['vercel production CRON_SECRET: expected present, actual missing']);
  assert.deepEqual(diffVercelEnv(required, () => null), []);
});

test('revenuecat offerings and entitlements are compared by lookup key only, and the key never leaks', async () => {
  const pages = { '/projects': { items: [{ id: 'proj1' }] }, '/projects/proj1/offerings': { items: [{ lookup_key: 'default' }] },
    '/projects/proj1/entitlements': { items: [{ lookup_key: 'pro' }] } };
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers.authorization, 'Bearer sk_secret_value');
    const body = pages[new URL(url).pathname.replace('/v2', '')];
    return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404 };
  };
  const actual = await fetchRevenueCat('sk_secret_value', fetchImpl);
  assert.deepEqual(actual, { offerings: ['default'], entitlements: ['pro'] });
  assert.deepEqual(diffRevenueCat({ offerings: ['default'], entitlements: ['pro'] }, actual), []);
  assert.deepEqual(diffRevenueCat({ offerings: ['default', 'trial'], entitlements: ['pro', 'plus'] }, actual),
    ['revenuecat offering trial: expected present, actual missing', 'revenuecat entitlement plus: expected present, actual missing']);
  await assert.rejects(fetchRevenueCat('sk_secret_value', async () => ({ ok: false, status: 401 })), /HTTP 401/);
  assert.equal(revenueCatKey({ env: { REVENUECAT_SECRET_KEY: 'from-env' }, file: '/nonexistent' }), 'from-env');
  assert.equal(revenueCatKey({ env: { REVENUECAT_SECRET_KEY: 'old', REVENUECAT_V2_READ_KEY: 'v2' }, file: '/nonexistent' }), 'v2');
  assert.equal(revenueCatKey({ env: {}, file: '/nonexistent' }), null);
});
