import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceStore, prepareActiveEntitlement, sandboxState } from './active-entitlement.mjs';

const now = () => Date.parse('2026-10-31T12:00:00Z');
const expiresAt = '2026-10-31T13:00:00.000Z';
const env = { EXPO_PUBLIC_API_URL: 'https://dev.fitsy.org', EXPO_PUBLIC_SUPABASE_URL: 'https://dev.supabase.co',
  EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'seed-sim-active@fitsy.dev', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'test-password',
  EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_fixture', EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_fixture' };
const built = { configuration: 'Debug', storeMode: 'test-store', buildMode: 'owned-metro-test-store' };
const subscriber = (expiry = expiresAt, store = 'test_store', sandbox = true) => ({ subscriber: {
  entitlements: { pro: { expires_date: expiry, product_identifier: 'monthly' } },
  subscriptions: { monthly: { is_sandbox: sandbox, store } },
} });
const status = { active: true, verdict: 'active', status: 'active', stale: false, expiresAt,
  lastRcVerifiedAt: new Date(now()).toISOString() };
function boundary(bodies) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = bodies.shift();
    if (body instanceof Error) throw body;
    assert.ok(body, `Unexpected request ${url}`);
    return { ok: true, json: async () => body };
  };
  return { calls, fetchImpl };
}
const login = { token: 'fixture-token', user: { id: '03975501-8b3d-4044-a636-7d79f7167531' } };

test('real Test Store history plus a fresh successful server sync establishes active evidence', async () => {
  const b = boundary([login, subscriber(), { synced: true }, status]);
  const receipt = await prepareActiveEntitlement({ built, env, now, fetchImpl: b.fetchImpl });
  assert.equal(receipt.sandbox, true); assert.equal(receipt.renewed, false);
  assert.equal(receipt.expiresAt, expiresAt);
  assert.ok(b.calls[1].url.endsWith(login.user.id));
  assert.equal(b.calls[1].options.headers['x-is-sandbox'], 'true');
  assert.equal(b.calls[2].url, env.EXPO_PUBLIC_API_URL + '/api/subscriptions/sync');
  assert.equal(b.calls[3].url, env.EXPO_PUBLIC_API_URL + '/api/subscriptions/status');
  assert.doesNotMatch(JSON.stringify(receipt), /fixture-token|test-password|test_fixture|seed-sim-active/);
});

for (const initial of [subscriber('2026-10-30T00:00:00Z'), { subscriber: { entitlements: {}, subscriptions: {} } }])
  test('lapsed or recreated fixture must complete one real purchase and recheck RevenueCat', async () => {
    const b = boundary([login, initial, subscriber(), { synced: true }, status]); let purchases = 0;
    const receipt = await prepareActiveEntitlement({ built, env, now, fetchImpl: b.fetchImpl, renew: async () => { purchases++; } });
    assert.equal(purchases, 1); assert.equal(receipt.renewed, true); assert.equal(b.calls.length, 5);
  });

test('a failed renewal stops before server sync and is never converted into a pass', async () => {
  const b = boundary([login, subscriber('2026-10-30T00:00:00Z')]);
  await assert.rejects(prepareActiveEntitlement({ built, env, now, fetchImpl: b.fetchImpl,
    renew: async () => { throw new Error('purchase failed'); } }), /purchase failed/);
  assert.equal(b.calls.length, 2);
});

test('a completed purchase dialog without active RevenueCat proof cannot synchronize or pass', async () => {
  const expired = subscriber('2026-10-30T00:00:00Z');
  const b = boundary([login, expired, expired]);
  await assert.rejects(prepareActiveEntitlement({ built, env, now, fetchImpl: b.fetchImpl, renew: async () => {} }),
    /did not establish an active/);
  assert.equal(b.calls.length, 3);
});

test('production API, production Supabase, release Test Store and unconfigured builds fail before login', () => {
  for (const [artifact, config] of [
    [built, { ...env, EXPO_PUBLIC_API_URL: 'https://api.fitsy.org' }],
    [built, { ...env, EXPO_PUBLIC_SUPABASE_URL: 'https://zaxkmjqozvmbifiwbxps.supabase.co' }],
    [{ ...built, configuration: 'Release' }, env], [{ ...built, storeMode: 'unconfigured' }, env],
    [built, { ...env, EXPO_PUBLIC_REVENUECAT_TEST_KEY: '' }],
  ]) assert.throws(() => evidenceStore(artifact, config));
});

test('Apple simulator accepts real sandbox state without selecting Test Store or purchasing', async () => {
  const b = boundary([login, subscriber(expiresAt, 'app_store'), { synced: true }, status]);
  const proof = await prepareActiveEntitlement({ built: { configuration: 'Release', storeMode: 'apple-simulator', buildMode: 'embedded-release' }, env, now,
    fetchImpl: b.fetchImpl, renew: async () => { assert.fail('must never buy from Apple automatically'); } });
  assert.equal(proof.storeMode, 'apple-simulator');
  assert.equal(b.calls[1].options.headers.authorization, 'Bearer appl_fixture');
  assert.equal(b.calls[1].options.headers['x-is-sandbox'], undefined);
});

test('expired Apple sandbox cannot invoke the Test Store renewal callback', async () => {
  const b = boundary([login, subscriber('2026-10-30T00:00:00Z', 'app_store')]);
  await assert.rejects(prepareActiveEntitlement({ built: { configuration: 'Release', storeMode: 'apple-simulator', buildMode: 'embedded-release' }, env, now, fetchImpl: b.fetchImpl,
    renew: async () => assert.fail('must not purchase') }), /inactive/);
});

test('production, promotional, malformed and unknown RevenueCat state cannot establish evidence', () => {
  for (const body of [{}, { subscriber: {} }, { subscriber: { entitlements: [], subscriptions: {} } },
    subscriber(expiresAt, 'app_store', false), subscriber(expiresAt, 'promotional'),
    subscriber('invalid'), subscriber(null), subscriber(expiresAt, 'unknown_store')])
    assert.throws(() => sandboxState(body, true, now()));
});

for (const changed of [{ synced: false }, { stale: true }, { active: false }, { status: null },
  { lastRcVerifiedAt: '2026-10-30T00:00:00Z' }, { expiresAt: '2026-10-31T11:00:00Z' }])
  test(`stale, bypassed or unconfirmed server state is rejected: ${JSON.stringify(changed)}`, async () => {
    const b = boundary([login, subscriber(), { synced: changed.synced ?? true }, { ...status, ...changed }]);
    await assert.rejects(prepareActiveEntitlement({ built, env, now, fetchImpl: b.fetchImpl }), /Server did not verify/);
  });

test('login failure and unknown provider state never register accounts or buy', async () => {
  for (const bodies of [[new Error('credentials')], [login, {}]]) {
    const b = boundary(bodies);
    await assert.rejects(prepareActiveEntitlement({ built, env, now, fetchImpl: b.fetchImpl,
      renew: async () => assert.fail('unknown state cannot buy') }));
    assert.ok(b.calls.every(call => !call.url.includes('register')));
  }
});
