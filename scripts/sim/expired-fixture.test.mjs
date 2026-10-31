import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expiredSession, prepareExpiredFixture, requireExpiredEnvironment, EXPIRED_WAIT_MS } from './expired-fixture.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const preview = 'https://fitsy-api-abc123-dawits-projects-74b6e00f.vercel.app';
const environment = (origin = preview) => ({
  EXPO_PUBLIC_API_URL: origin, EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_fixture',
  FITSY_SIM_EXPIRED_LOGIN_EMAIL: 'seed-sim-expired@fitsy.dev', FITSY_SIM_EXPIRED_LOGIN_PASSWORD: 'fixture-password',
});
function login(t, id = userId) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, json: async () => ({ token: 'fixture-token', user: { id } }) };
  });
  return calls;
}
async function withState(action) {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-expired-fixture-'));
  try { await action(join(directory, 'state.json')); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('preview and stable dev use the selected API origin without replacing it', async t => {
  const calls = login(t);
  for (const origin of [preview, 'https://dev.fitsy.org', 'http://localhost:3000', 'http://127.0.0.1:3000']) {
    const env = environment(origin);
    assert.deepEqual(await expiredSession(env), { userId, token: 'fixture-token' });
    assert.equal(env.EXPO_PUBLIC_API_URL, origin);
    const request = calls.at(-1);
    assert.equal(request.url, origin + '/api/auth/login');
    assert.deepEqual(JSON.parse(request.options.body), { email: env.FITSY_SIM_EXPIRED_LOGIN_EMAIL, password: 'fixture-password' });
  }
});

test('production, unrelated projects and URL tricks fail before login or native preparation', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('must not send credentials'));
  for (const origin of ['https://fitsy.org', 'https://api.fitsy.org', 'https://fitsy-api-other.vercel.app',
    'https://dev.fitsy.org.evil.test', 'https://dev.fitsy.org@evil.test', preview + '/path', preview + '?query=1',
    'http://dev.fitsy.org', 'http://localhost:3000@evil.test', 'not-a-url']) {
    await assert.rejects(expiredSession(environment(origin)));
  }
});

test('non-Test Store billing and changed seed credentials fail before login', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('must not log in'));
  for (const change of [{ EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'appl_fixture' },
    { FITSY_SIM_EXPIRED_LOGIN_EMAIL: 'somebody@fitsy.dev' }, { FITSY_SIM_EXPIRED_LOGIN_PASSWORD: '' }]) {
    assert.throws(() => requireExpiredEnvironment({ ...environment(), ...change }), /requires/);
  }
});

test('purchase once on preview, retain the full advisory window, then log in without buying', async t => withState(async stateFile => {
  login(t);
  let at = Date.parse('2026-10-31T18:00:00Z');
  const actions = [];
  const options = { env: environment(), stateFile, now: () => at, runMakeExpired: async action => actions.push(action) };
  const first = await prepareExpiredFixture(options);
  assert.equal(first.ready, false);
  assert.deepEqual(actions, [{ allowPurchase: true }]);
  const saved = readFileSync(stateFile, 'utf8');
  assert.deepEqual(JSON.parse(saved), { userId, purchasedAt: '2026-10-31T18:00:00.000Z' });
  assert.equal(statSync(stateFile).mode & 0o777, 0o600);
  at += EXPIRED_WAIT_MS - 1;
  assert.equal((await prepareExpiredFixture(options)).ready, false);
  assert.equal(actions.length, 1);
  at += 1;
  assert.equal((await prepareExpiredFixture(options)).ready, true);
  // Stable dev shares the seed's RevenueCat history and must not rebuy it.
  options.env = environment('https://dev.fitsy.org');
  assert.equal((await prepareExpiredFixture(options)).ready, true);
  assert.deepEqual(actions, [{ allowPurchase: true }, { allowPurchase: false }, { allowPurchase: false }]);
  assert.equal(readFileSync(stateFile, 'utf8'), saved);
}));

test('a changed login UUID cannot inherit a previous purchase timestamp', async t => withState(async stateFile => {
  login(t);
  writeFileSync(stateFile, JSON.stringify({ userId: '22222222-2222-4222-8222-222222222222', purchasedAt: '2026-10-25T07:00:00Z' }));
  const actions = [];
  const result = await prepareExpiredFixture({ env: environment(), stateFile, now: () => Date.parse('2026-10-31T18:00:00Z'),
    runMakeExpired: async action => actions.push(action) });
  assert.equal(result.ready, false);
  assert.equal(result.userId, userId);
  assert.deepEqual(actions, [{ allowPurchase: true }]);
}));

test('failed native preparation never records purchase or permits the next flow', async t => withState(async stateFile => {
  login(t);
  await assert.rejects(prepareExpiredFixture({ env: environment(), stateFile,
    runMakeExpired: async () => { throw new Error('native setup failed'); } }), /native setup failed/);
  assert.equal(existsSync(stateFile), false);
}));

test('corrupt or future history fails without renewal', async t => withState(async stateFile => {
  login(t);
  for (const data of ['{bad-json', ...['invalid', '2099-01-01T00:00:00Z'].map(purchasedAt => JSON.stringify({ userId, purchasedAt }))]) {
    writeFileSync(stateFile, data);
    await assert.rejects(prepareExpiredFixture({ env: environment(), stateFile,
      runMakeExpired: async () => assert.fail('must not buy') }));
    assert.equal(readFileSync(stateFile, 'utf8'), data);
  }
}));

test('login failure or a missing account identity fails without native setup', async t => {
  for (const result of [{ ok: false, status: 503 }, { ok: true, json: async () => ({ token: 'token' }) },
    { ok: true, json: async () => ({ user: { id: userId } }) }]) {
    t.mock.method(globalThis, 'fetch', async () => result);
    await assert.rejects(prepareExpiredFixture({ env: environment(),
      runMakeExpired: async () => assert.fail('must not buy') }), /login/);
  }
});
