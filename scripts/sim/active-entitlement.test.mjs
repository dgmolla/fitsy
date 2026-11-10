import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { evidenceStore, prepareActiveEntitlement, sandboxState, verifyInactiveEntitlement, verifyRemainingLifetime } from './active-entitlement.mjs';
import { prepareEntitledEvidence, prepareBillingEvidence } from './product-flow.mjs';
import { classifySimulatorFailure, withEnvironmentRetry } from './failure-policy.mjs';

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

test('entitlement startup retries observations without replaying login, purchase or final assertions', () => {
  const [header, commands] = yaml.loadAll(readFileSync(new URL('../../apps/mobile/e2e/helpers/active-entitlement.yaml', import.meta.url), 'utf8'));
  assert.deepEqual(header, { appId: 'com.fitsy.mobile' });
  assert.deepEqual(commands[0], { launchApp: { clearState: true, clearKeychain: true } });
  assert.deepEqual(commands[1], { retry: { maxRetries: 2, commands: [
    { waitForAnimationToEnd: { timeout: 10000 } },
    { extendedWaitUntil: { visible: { id: 'welcome-login' }, timeout: 60000 } },
  ] } });
  assert.deepEqual(commands.slice(2), [
    { tapOn: { id: 'welcome-login' } },
    { extendedWaitUntil: { visible: 'Welcome back', timeout: 15000 } },
    { tapOn: '.*Dev Login.*' },
    { extendedWaitUntil: { visible: '.*(Search restaurants or dishes|subscription ended|Continue to purchase).*', timeout: 30000 } },
    { assertNotVisible: 'Dev Login Failed' },
    { runFlow: { when: { notVisible: 'Search restaurants or dishes' }, commands: [
      { assertTrue: "${ALLOW_TEST_PURCHASE === '1'}" },
      { runFlow: { when: { visible: '.*Open debugger to view warnings.*' }, commands: [{ tapOn: { point: '93%,93%' } }] } },
      { tapOn: { id: 'welcome-continue' } },
      { extendedWaitUntil: { visible: 'Test Store Purchase', timeout: 20000 } },
      { assertNotVisible: 'Sign in with Apple ID' },
      { tapOn: 'Test valid purchase' },
    ] } },
    { extendedWaitUntil: { visible: 'Search restaurants or dishes', timeout: 30000 } },
    { assertNotVisible: { id: 'resubscribe-restore' } },
  ]);
});

test('inactive billing admission distinguishes expired history from a valid never-subscribed login', async () => {
  const empty = { subscriber: { entitlements: {}, subscriptions: {}, non_subscriptions: {} } };
  for (const [fixture, provider, allowed] of [
    ['expired-subscription', empty, false],
    ['expired-subscription', subscriber('2026-10-30T00:00:00Z'), true],
    ['expired-subscription', subscriber(), false],
    ['expired-subscription', subscriber('2026-10-30T00:00:00Z', 'app_store', false), false],
    ['empty-store', empty, true],
    ['empty-store', subscriber('2026-10-30T00:00:00Z'), false],
    ['empty-store', { subscriber: { ...empty.subscriber, non_subscriptions: { lifetime: [{}] } } }, false],
    ['empty-store', { subscriber: {} }, false],
  ]) {
    const b = boundary([login, provider]);
    const check = verifyInactiveEntitlement({ fixture, built, env, now, fetchImpl: b.fetchImpl });
    if (allowed) {
      const proof = await check;
      assert.equal(proof.fixture, fixture);
      assert.equal(proof.expiresAt, fixture === 'expired-subscription' ? '2026-10-30T00:00:00.000Z' : null);
      assert.doesNotMatch(JSON.stringify(proof), /fixture-token|test-password|test_fixture|seed-sim-active/);
    } else await assert.rejects(check);
    assert.equal(b.calls.length, 2);
    assert.ok(b.calls.every(call => !/sync|purchase|register/.test(call.url)));
  }
});

test('billing setup requires native sign-in after history admission and rejects a failed driver', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-billing-caller-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const executable = join(dir, 'maestro'), calls = join(dir, 'calls');
  writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs');\nconst args=process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({destination:args.find(x=>x.startsWith('DESTINATION=')),flow:args.at(-1),hasLoginArgument:args.some(x=>/^EXPO_PUBLIC_DEV_LOGIN_(EMAIL|PASSWORD)=/.test(x))})+'\\n');\nprocess.exit(17);\n`, { mode: 0o755 });
  const config = { ...env, MAESTRO_BIN: executable };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  for (const fixture of ['empty-store', 'expired-subscription']) {
    writeFileSync(calls, '');
    const empty = { subscriber: { entitlements: {}, subscriptions: {} } };
    const b = boundary([login, fixture === 'empty-store' ? empty : subscriber('2020-01-01T00:00:00Z')]);
    const fetchMock = t.mock.method(globalThis, 'fetch', b.fetchImpl);
    try {
      await assert.rejects(prepareBillingEvidence(built, '11111111-1111-1111-1111-111111111111', join(dir, fixture), fixture),
        /native sign-in failed/);
      const call = JSON.parse(readFileSync(calls, 'utf8'));
      assert.equal(call.hasLoginArgument, false, 'UI-only billing setup must not expose credentials in argv or Maestro variable logs');
      assert.equal(call.destination, `DESTINATION=${fixture === 'empty-store' ? 'paywall-restore' : 'resubscribe-restore'}`);
      assert.ok(call.flow.endsWith('/e2e/helpers/ci-signin.yaml'));
    } finally { fetchMock.mock.restore(); }
  }
  writeFileSync(calls, '');
  const b = boundary([login, { subscriber: { entitlements: {}, subscriptions: {} } }]);
  const fetchMock = t.mock.method(globalThis, 'fetch', b.fetchImpl);
  try {
    await assert.rejects(prepareBillingEvidence(built, '11111111-1111-1111-1111-111111111111', join(dir, 'missing-history'), 'expired-subscription'),
      /genuine expired/);
    assert.equal(readFileSync(calls, 'utf8'), '');
  } finally { fetchMock.mock.restore(); }
});

test('native fixture failures retain their command diagnosis and respect the remaining retry budget', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-fixture-diagnosis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const executable = join(dir, 'maestro');
  const config = { ...env, MAESTRO_BIN: executable };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  for (const fixture of ['empty-store', 'expired-subscription', 'active-signin', 'active-renew']) {
    for (const [diagnostic, allowed, classification, attempts] of [
      ['kAXErrorInvalidUIElement during Welcome hierarchy read', true, 'environment', 2],
      ['kAXErrorInvalidUIElement during Welcome hierarchy read', false, 'environment', 1],
      ['Element welcome-login is not visible', true, 'code', 1],
    ]) {
      const receipt = [{ command: { assertConditionCommand: { condition: { visible: { idRegex: 'welcome-login' } } } },
        metadata: { status: 'FAILED', timestamp: 1, error: { message: diagnostic } } }];
      writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');\nconst args=process.argv.slice(2),dir=args[args.indexOf('--test-output-dir')+1];\nfs.writeFileSync(path.join(dir,'commands-fixture.json'),${JSON.stringify(JSON.stringify(receipt))});\nprocess.exit(17);\n`, { mode: 0o755 });
      const expiry = new Date(Date.now() + 3600000).toISOString();
      const bodies = fixture === 'active-signin' ? [login, subscriber(expiry), { synced: true },
        { ...status, expiresAt: expiry, lastRcVerifiedAt: new Date().toISOString() }]
        : [login, fixture === 'empty-store' ? { subscriber: { entitlements: {}, subscriptions: {} } }
          : subscriber('2020-01-01T00:00:00Z')];
      const b = boundary(Array.from({ length: attempts }, () => bodies).flat());
      const fetchMock = t.mock.method(globalThis, 'fetch', b.fetchImpl);
      const evidence = join(dir, `${fixture}-${classification}-${allowed}`);
      let calls = 0;
      try {
        await assert.rejects(withEnvironmentRetry(async attemptDir => {
          calls++;
          if (fixture.startsWith('active-'))
            return prepareEntitledEvidence(built, '11111111-1111-1111-1111-111111111111', attemptDir, { signIn: true });
          return prepareBillingEvidence(built, '11111111-1111-1111-1111-111111111111', attemptDir, fixture);
        }, { dir: evidence, canRetry: () => allowed }), error => {
          assert.equal(classifySimulatorFailure(error), classification);
          assert.equal(error.diagnostic, diagnostic);
          return true;
        });
        assert.equal(calls, attempts);
        const saved = JSON.parse(readFileSync(join(evidence, 'attempts.json'), 'utf8'));
        assert.deepEqual(saved.map(row => [row.status, row.classification, row.retry]),
          Array.from({ length: attempts }, (_, index) => ['fail', classification, attempts === 2 && index === 0]));
        const setup = fixture === 'active-signin' ? 'signin' : fixture === 'active-renew' ? 'renew' : '';
        for (let index = 0; index < attempts; index++)
          assert.deepEqual(JSON.parse(readFileSync(join(evidence, index ? 'attempt-2' : '', setup, 'commands-fixture.json'), 'utf8')), receipt);
      } finally { fetchMock.mock.restore(); }
    }
  }
});

test('remaining-lifetime preflight accepts ample time, and rejects expired or nearly-exhausted entitlements', async () => {
  const soon = new Date(now() + 5 * 60 * 1000).toISOString(); // under the 10-minute margin
  for (const [provider, allowed] of [
    [subscriber(new Date(now() + 3600000).toISOString()), true],
    [subscriber(soon), false],
    [subscriber('2020-01-01T00:00:00Z'), false],
    [{ subscriber: { entitlements: {}, subscriptions: {} } }, false],
  ]) {
    const b = boundary([login, provider]);
    const check = verifyRemainingLifetime({ built, env, now, fetchImpl: b.fetchImpl });
    if (allowed) {
      const proof = await check;
      assert.equal(proof.fixture, 'entitled-dev'); assert.ok(proof.remainingMs >= 10 * 60 * 1000);
      assert.doesNotMatch(JSON.stringify(proof), /fixture-token|test-password|test_fixture|seed-sim-active/);
    } else await assert.rejects(check, /paid lifetime/);
    assert.equal(b.calls.length, 2);
    assert.ok(b.calls.every(call => !/sync|purchase|register/.test(call.url)));
  }
});

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

test('walkthrough setup signs in once, retaining a verified renewal instead of resetting it again', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-entitlement-caller-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const executable = join(dir, 'maestro'), calls = join(dir, 'calls');
  writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs');\nconst purchase=process.argv.find(arg=>arg.startsWith('ALLOW_TEST_PURCHASE='));\nfs.appendFileSync(${JSON.stringify(calls)},purchase+'\\n');\n`, { mode: 0o755 });
  const config = { ...env, MAESTRO_BIN: executable };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  for (const renew of [false, true]) {
    writeFileSync(calls, '');
    const expiry = new Date(Date.now() + 3600000).toISOString();
    const freshStatus = { ...status, expiresAt: expiry, lastRcVerifiedAt: new Date().toISOString() };
    const b = boundary([login, ...(renew ? [subscriber('2020-01-01T00:00:00Z')] : []),
      subscriber(expiry), { synced: true }, freshStatus]);
    const fetchMock = t.mock.method(globalThis, 'fetch', b.fetchImpl);
    try {
      const proof = await prepareEntitledEvidence(built, '11111111-1111-1111-1111-111111111111',
        join(dir, renew ? 'renewed' : 'active'), { signIn: true });
      assert.equal(proof.renewed, renew);
      assert.equal(readFileSync(calls, 'utf8'), `ALLOW_TEST_PURCHASE=${renew ? '1' : '0'}\n`);
    } finally { fetchMock.mock.restore(); }
  }
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
