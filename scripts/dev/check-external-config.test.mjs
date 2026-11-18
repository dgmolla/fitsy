import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSettings, diffEnvNames, envNames, check } from './check-external-config.mjs';

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
