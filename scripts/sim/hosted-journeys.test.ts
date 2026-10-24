import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const runner = resolve(__dirname, 'ci.mjs');
const planner = resolve(__dirname, '../verify/impact-plan.mjs');
const policy = resolve(__dirname, 'hosted-journeys.mjs');
function evaluate(source: string) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: resolve(__dirname, '../..'), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

test('every full-scope flow has explicit hosted execution or a retained Apple acceptance obligation', () => {
  const result = evaluate(`
    import {simulatorFlows} from ${JSON.stringify(planner)};
    import {hostedCoverage} from ${JSON.stringify(policy)};
    const flows = simulatorFlows();
    process.stdout.write(JSON.stringify({...hostedCoverage(flows), flows}));`);
  expect(result.acceptance).toEqual([expect.objectContaining({
    flow: 'subscription-restore-expired', required: true, status: 'not_run', storeMode: 'apple',
    reason: expect.stringContaining('Test Store cannot transfer'),
  })]);
  expect(result.hosted).toEqual(expect.arrayContaining(['subscription-expired-routing', 'subscription-restore-empty']));
  expect(result.hosted).not.toContain('subscription-restore-expired');
  expect([...result.hosted, ...result.acceptance.map((item: { flow: string }) => item.flow)].sort()).toEqual(result.flows);
});

test.each([
  { flow: 'subscription-expired-routing', kind: 'expired', checkpoint: 'resubscribe-restore' },
  { flow: 'subscription-restore-empty', kind: 'never_subscribed', checkpoint: 'paywall-restore' },
])('$flow establishes its own authenticated state even after signin-options clears authentication', entry => {
  const result = evaluate(`
    import {readFileSync} from 'node:fs';
    import {createRequire} from 'node:module';
    import {hostedJourney} from ${JSON.stringify(policy)};
    const yaml = createRequire(import.meta.url)('js-yaml');
    const load = name => yaml.loadAll(readFileSync('apps/mobile/e2e/' + name + '.yaml','utf8'));
    const source = load('flows/${entry.flow}');
    const setup = load('setup/billing-signin');
    process.stdout.write(JSON.stringify({source, journey: hostedJourney('${entry.flow}', source, setup)}));`);
  const commands = result.journey[1];
  expect(commands[0]).toEqual({ launchApp: { clearState: true, clearKeychain: true } });
  expect(commands).toContainEqual({ openLink: 'com.fitsy.mobile://welcome/payment' });
  const login = commands.findIndex((step: { tapOn?: string }) => step.tapOn === 'Dev login');
  expect(login).toBeGreaterThan(0);
  expect(commands[login + 1]).toEqual({ extendedWaitUntil: { visible: { id: entry.checkpoint }, timeout: 30000 } });
  expect(commands.slice(login + 2)).toEqual(result.source[1]);
});

test('the actual hosted CLI reports the retained Apple acceptance requirement', () => {
  const result = spawnSync(process.execPath, [runner, '--scope=all', '--plan'], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('subscription-restore-expired');
  expect(result.stderr).toContain('Apple acceptance required separately');
});

const credentials = {
  EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'empty@example.test', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'empty-password',
  FITSY_SIM_EXPIRED_LOGIN_EMAIL: 'expired@example.test', FITSY_SIM_EXPIRED_LOGIN_PASSWORD: 'expired-password',
};
test.each([
  { extra: { FITSY_SIM_EXPIRED_LOGIN_EMAIL: '' }, error: 'expired Test Store account' },
  { extra: { FITSY_SIM_EXPIRED_LOGIN_PASSWORD: '' }, error: 'expired Test Store account' },
  { extra: { EXPO_PUBLIC_DEV_LOGIN_PASSWORD: '' }, error: 'never_subscribed Test Store account' },
  { extra: { FITSY_SIM_EXPIRED_LOGIN_EMAIL: 'EMPTY@example.test' }, error: 'distinct disposable accounts' },
  { extra: { FITSY_SIM_EXPIRED_LOGIN_EMAIL: 'dev@fitsy.local' }, error: 'expired Test Store account' },
])('invalid billing fixture configuration fails before native work: $extra', entry => {
  const result = evaluate(`
    import {hostedAccounts} from ${JSON.stringify(policy)};
    try { hostedAccounts(['subscription-expired-routing'], ${JSON.stringify({ ...credentials, ...entry.extra })}); }
    catch (error) { process.stdout.write(JSON.stringify({error:error.message})); }`);
  expect(result.error).toContain(entry.error);
});

test('unrelated affected flows do not require an expired billing account', () => {
  const result = evaluate(`
    import {hostedAccounts} from ${JSON.stringify(policy)};
    process.stdout.write(JSON.stringify(Object.keys(hostedAccounts(['reminders'], ${JSON.stringify({
      EXPO_PUBLIC_DEV_LOGIN_EMAIL: credentials.EXPO_PUBLIC_DEV_LOGIN_EMAIL,
      EXPO_PUBLIC_DEV_LOGIN_PASSWORD: credentials.EXPO_PUBLIC_DEV_LOGIN_PASSWORD,
    })}))));`);
  expect(result).toEqual(['never_subscribed']);
});

test.each([
  { flows: ['reminders'], expired: false },
  { flows: ['subscription-restore-empty'], expired: false },
  { flows: ['subscription-expired-routing'], expired: true },
])('configuration preflight requires only the selected account kinds: $flows', ({ flows, expired }) => {
  const result = evaluate(`
    import {hostedConfiguration} from ${JSON.stringify(policy)};
    try {
      const {profile, accounts} = hostedConfiguration(${JSON.stringify(flows)}, ${JSON.stringify({
        EXPO_PUBLIC_SUPABASE_URL: 'https://dev-fixture.supabase.co',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key',
        EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_fixture',
        EXPO_PUBLIC_DEV_LOGIN_EMAIL: credentials.EXPO_PUBLIC_DEV_LOGIN_EMAIL,
        EXPO_PUBLIC_DEV_LOGIN_PASSWORD: credentials.EXPO_PUBLIC_DEV_LOGIN_PASSWORD,
      })});
      process.stdout.write(JSON.stringify({storeMode:profile.storeMode, accounts:Object.keys(accounts)}));
    } catch (error) { process.stdout.write(JSON.stringify({error:error.message})); }`);
  if (expired) {
    expect(result.error).toContain('FITSY_SIM_EXPIRED_LOGIN_EMAIL');
    expect(result.error).toContain('FITSY_SIM_EXPIRED_LOGIN_PASSWORD');
  } else expect(result).toEqual({ storeMode: 'test-store', accounts: ['never_subscribed'] });
});

const freshStatus = { synced: true, active: false, stale: false, lastRcVerifiedAt: new Date().toISOString() };
test.each([
  { kind: 'expired', status: { ...freshStatus, verdict: 'expired' }, ok: true },
  { kind: 'never_subscribed', status: { ...freshStatus, verdict: 'never_subscribed' }, ok: true },
  { kind: 'expired', status: { ...freshStatus, verdict: 'active', active: true }, ok: false },
  { kind: 'expired', status: { ...freshStatus, verdict: 'never_subscribed' }, ok: false },
  { kind: 'never_subscribed', status: { ...freshStatus, verdict: 'expired' }, ok: false },
  { kind: 'expired', status: { ...freshStatus, verdict: 'expired', synced: false }, ok: false },
  { kind: 'expired', status: { ...freshStatus, verdict: 'expired', stale: true }, ok: false },
  { kind: 'expired', status: { ...freshStatus, verdict: 'expired', lastRcVerifiedAt: '2020-01-01' }, ok: false },
  { kind: 'expired', status: { ...freshStatus, verdict: 'expired', lastRcVerifiedAt: null }, ok: false },
])('real API preflight requires the correct fresh billing state: $kind $status', entry => {
  const result = evaluate(`
    import {verifyBillingFixture} from ${JSON.stringify(policy)};
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({url,...init,signal:undefined});
      return {ok:true,json:async()=>url.endsWith('/login') ?
        {token:'private-token',user:{id:'fixture-id',email:'fixture@example.test'}} : ${JSON.stringify(entry.status)}};
    };
    try {
      const receipt = await verifyBillingFixture({kind:'${entry.kind}',email:'fixture@example.test',password:'private-password'});
      process.stdout.write(JSON.stringify({ok:true,receipt,requests}));
    } catch (error) { process.stdout.write(JSON.stringify({ok:false,error:error.message,requests})); }`);
  expect(result.ok).toBe(entry.ok);
  expect(result.requests.map((request: { url: string }) => request.url))
    .toEqual(['https://dev.fitsy.org/api/auth/login', 'https://dev.fitsy.org/api/subscriptions/sync']);
  expect(JSON.parse(result.requests[0].body)).toEqual({ email: 'fixture@example.test', password: 'private-password' });
  expect(result.requests[1].headers.Authorization).toBe('Bearer private-token');
  expect(JSON.stringify(result.receipt ?? result.error)).not.toMatch(/private-token|private-password/);
});
