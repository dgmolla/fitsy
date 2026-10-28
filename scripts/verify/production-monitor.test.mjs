import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { policy, alert, evaluateApi, evaluateDeployment, evaluateMobile, evaluateQuota, evaluateExpiry, evaluateCrons } from './production-policy.mjs';
import { axiomRows, probeApi, queryAxiom, apiMetrics } from './production-providers.mjs';
import { dispatchAlerts, loadAlertState, saveAlertState, sendSlack } from './production-alerts.mjs';
import { assertRequiredEnvironment, checkEnvironmentSources, readManifest } from '../deploy/env-manifest.mjs';
import { runMonitor } from './production-monitor.mjs';

const now = Date.parse('2026-10-28T19:00:00Z');
const row = overrides => ({ route: '/api/subscriptions/status', method: 'GET', requests: 100, errors: 0,
  rejected: 0, p95: 100, lastSeen: new Date(now).toISOString(), ...overrides });
const table = rows => ({ status: { isPartial: false }, tables: [{
  fields: Object.keys(rows[0] ?? {}).map(name => ({ name })),
  columns: Object.keys(rows[0] ?? {}).map(key => rows.map(item => item[key])),
}] });

/** In-memory external GitHub/Slack HTTP servers, with serialized persistence. */
function transport() {
  let body;
  const messages = [];
  let rejectSlack = false;
  const env = { GITHUB_TOKEN: 'private-gh-token', SLACK_BOT_TOKEN: 'private-slack-token', SLACK_ALERT_USER_ID: 'UFIXTURE' };
  const fetchImpl = async (url, init = {}) => {
    if (url.includes('/issues?')) return Response.json(body ? [{ number: 606, body }] : []);
    if (url.endsWith('/issues') && init.method === 'POST') { body = JSON.parse(init.body).body; return Response.json({ number: 606 }); }
    if (url.endsWith('/issues/606') && init.method === 'PATCH') { body = JSON.parse(init.body).body; return Response.json({ number: 606 }); }
    if (url === 'https://slack.com/api/chat.postMessage') {
      const message = JSON.parse(init.body);
      if (rejectSlack) return Response.json({ ok: false, error: 'fixture rejection' });
      messages.push(message);
      return Response.json({ ok: true });
    }
    throw new Error('Unexpected external request');
  };
  const context = { env, fetchImpl, policy };
  return { context, messages, reject(value) { rejectSlack = value; }, async tick(observations, at = now) {
    const store = await loadAlertState(context);
    await dispatchAlerts({ observations, state: store.state, now: at, policy,
      save: state => saveAlertState(store.number, state, context),
      send: (message, urgent, destination) => sendSlack(message, urgent, context, destination),
    });
  } };
}

test('synthetics accept expected 401s, authenticate deep health only, and page a handled 503', async () => {
  const requests = [];
  let broken = false;
  const fetchImpl = async (url, init) => {
    requests.push([url, init]);
    const path = new URL(url).pathname;
    if (url.endsWith('?deep=1')) return Response.json({ status: 'ok', dependencies: { supabase: 'ok', upstash: 'ok', revenuecat: 'ok' } });
    if (path === '/api/health') return Response.json({ status: 'ok', db: 'connected', deploymentSha: 'a'.repeat(40) });
    return Response.json({ error: 'fixture-private-body' }, { status: broken && path.endsWith('/status') ? 503 : 401 });
  };
  assert.deepEqual((await probeApi({ fetchImpl, env: { CRON_SECRET: 'private-cron' } })).alerts, []);
  assert.equal(requests.filter(([, init]) => init.headers.authorization === 'Bearer private-cron').length, 1);
  broken = true;
  const result = await probeApi({ fetchImpl, env: { CRON_SECRET: 'private-cron' } });
  const external = transport();
  await external.tick([{ scope: 'probes', alerts: result.alerts }]);
  assert.equal(external.messages.length, 2); // channel + direct urgency path
  assert.deepEqual(external.messages.map(message => message.channel), [policy.channel, 'UFIXTURE']);
  assert.match(external.messages[0].text, /503/);
  assert.doesNotMatch(JSON.stringify(external.messages), /private-cron|fixture-private-body/);
});

test('a 503 burst through the real Axiom decoder/evaluator pages Slack', async () => {
  const context = { now, env: { AXIOM_TOKEN: 'private-token' }, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.axiom.co/v1/datasets/_apl?format=tabular');
    const query = JSON.parse(init.body);
    assert.match(query.apl, /type == 'api_request' and environment == 'production'/);
    return Response.json(table([row({ requests: 10, errors: 10 })]));
  } };
  const signals = await apiMetrics(context);
  const external = transport();
  await external.tick([{ scope: 'api', alerts: signals }]);
  assert.match(external.messages[0].text, /10\/10 API requests returned 5xx/);
});

test('API alerts use strictly >2% OR >=10 errors, including low-volume outages', () => {
  assert.equal(evaluateApi([row({ requests: 100, errors: 2 })], [], now).length, 0);
  assert.equal(evaluateApi([row({ requests: 100, errors: 3 })], [], now)[0].key, 'api:5xx');
  assert.equal(evaluateApi([row({ requests: 10_000, errors: 10 })], [], now)[0].key, 'api:5xx');
  assert.equal(evaluateApi([row({ requests: 1, errors: 1 })], [], now)[0].key, 'api:5xx');
  assert.equal(evaluateApi([], [], now)[0].key, 'api:telemetry-missing');
});

test('p95 regression, webhook signature bursts and malformed metrics are visible', () => {
  assert.equal(evaluateApi([row({ p95: 5000 })], [row({ p95: 1000 })], now)[0].severity, 'P2');
  assert.equal(evaluateApi([row({ p95: 2500 })], [row({ p95: 2000 })], now).length, 0);
  assert.equal(evaluateApi([row({ p95: 5000, requests: 2 })], [], now).length, 0);
  assert.equal(evaluateApi([row({ route: '/api/revenuecat/webhook', rejected: 10 })], [], now)[0].key, 'webhook:rejected');
  assert.throws(() => evaluateApi([row({ errors: 101 })], [], now));
  assert.throws(() => evaluateApi([row({ route: '/api/user/private@example.test' })], [], now));
});

test('partial Axiom data, denied query credentials and malformed tables cannot pass', async () => {
  assert.deepEqual(axiomRows(table([row()])), [row()]);
  assert.throws(() => axiomRows({ ...table([row()]), status: { isPartial: true } }));
  assert.throws(() => axiomRows({ status: { isPartial: false }, tables: [{ fields: [{ name: 'x' }], columns: [] }] }));
  await assert.rejects(queryAxiom('query', now - 300_000, now, { env: {}, fetchImpl: fetch }));
  await assert.rejects(queryAxiom('query', now - 300_000, now,
    { env: { AXIOM_TOKEN: 'private' }, fetchImpl: async () => new Response(null, { status: 403 }) }));
});

test('shared issue state deduplicates fresh instances, sends one recovery, and preserves unobserved failures', async () => {
  const external = transport();
  const outage = { scope: 'api', alerts: [alert('api:5xx', 'api', 'P1', 'API outage')] };
  await external.tick([outage]);
  await external.tick([outage], now + 60_000);
  assert.equal(external.messages.length, 2);
  await external.tick([{ scope: 'observer', alerts: [alert('observer:api', 'observer', 'P2', 'Axiom unavailable')] }], now + 120_000);
  assert.equal(external.messages.length, 3);
  assert.ok((await loadAlertState(external.context)).state.incidents['api:5xx'].active);
  await external.tick([{ scope: 'api', alerts: [] }], now + 180_000);
  assert.equal(external.messages.filter(message => message.text.includes('RESOLVED')).length, 2);
  await external.tick([{ scope: 'api', alerts: [] }], now + 240_000);
  assert.equal(external.messages.length, 5);
});

test('failed Slack delivery is not marked delivered and is retried by the next instance', async () => {
  const external = transport();
  const outage = [{ scope: 'api', alerts: [alert('api:5xx', 'api', 'P1', 'API outage')] }];
  external.reject(true);
  await assert.rejects(external.tick(outage));
  const persisted = await loadAlertState(external.context);
  assert.equal(persisted.state.incidents['api:5xx'].deliveredAt, null);
  external.reject(false);
  await external.tick(outage, now + 60_000);
  assert.equal(external.messages.length, 2);
});

test('missing direct routing preserves the successful channel receipt and does not starve warnings', async () => {
  const external = transport();
  delete external.context.env.SLACK_ALERT_USER_ID;
  const outage = [{ scope: 'api', alerts: [alert('api:5xx', 'api', 'P1', 'API outage'), alert('latency', 'api', 'P2', 'Latency regression')] }];
  await assert.rejects(external.tick(outage));
  assert.equal(external.messages.length, 2);
  const stored = (await loadAlertState(external.context)).state;
  assert.deepEqual(stored.incidents['api:5xx'].pending.delivered, ['channel']);
  external.context.env.SLACK_ALERT_USER_ID = 'UFIXTURE';
  await external.tick(outage, now + 60_000);
  assert.equal(external.messages.length, 3);
  assert.equal(external.messages[2].channel, 'UFIXTURE');
});

test('warning escalation pages immediately and continued failures receive bounded reminders', async () => {
  const external = transport();
  const signal = severity => [{ scope: 'quota', alerts: [alert('upstash:quota', 'quota', severity, 'Quota almost exhausted')] }];
  await external.tick(signal('P2'));
  assert.equal(external.messages.length, 1);
  await external.tick(signal('P1'), now + 1000);
  assert.equal(external.messages.length, 3);
  await external.tick(signal('P1'), now + policy.reminderMinutes * 60_000 + 1001);
  assert.equal(external.messages.length, 5);
});

test('stale serving source and failed production deployments alert with a 30 minute grace', () => {
  const input = { mainSha: 'a'.repeat(40), servingSha: 'b'.repeat(40), mainChangedAt: new Date(now - 29 * 60_000).toISOString(), latest: { readyState: 'READY' } };
  assert.deepEqual(evaluateDeployment(input, now), []);
  assert.equal(evaluateDeployment(input, now + 2 * 60_000)[0].key, 'deploy:stale');
  assert.equal(evaluateDeployment({ ...input, latest: { readyState: 'ERROR' } }, now)[0].key, 'deploy:error');
  assert.throws(() => evaluateDeployment({ ...input, servingSha: null }, now));
});

test('mobile denominator and baseline distinguish genuine unknown/server-error spikes', () => {
  assert.deepEqual(evaluateMobile([10, 0, 100, 0, 0]), []);
  assert.equal(evaluateMobile([10, 2, 100, 1, 0])[0].key, 'mobile:subscription');
  assert.deepEqual(evaluateMobile([10, 2, 100, 20, 0]), []);
  assert.deepEqual(evaluateMobile([1, 1, 0, 0, 0]), []);
  assert.equal(evaluateMobile([0, 0, 0, 0, 1])[0].severity, 'P1');
  assert.throws(() => evaluateMobile([0, 5, 0, 0, 0]));
});

test('quota, TLS/domain expiry and missed cron thresholds remain checked in', () => {
  assert.deepEqual(evaluateQuota(79, 100), []);
  assert.equal(evaluateQuota(80, 100)[0].severity, 'P2');
  assert.equal(evaluateQuota(95, 100)[0].severity, 'P1');
  assert.throws(() => evaluateQuota(5, 0));
  assert.equal(evaluateExpiry('TLS', new Date(now + 2 * 86_400_000).toISOString(), now)[0].severity, 'P1');
  const fresh = Object.keys(policy.cronMaxAgeHours).map(route => ({ route, lastSuccess: new Date(now).toISOString() }));
  assert.deepEqual(evaluateCrons(fresh, now), []);
  assert.equal(evaluateCrons([], now).length, fresh.length);
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url)));
  assert.deepEqual(Object.keys(policy.cronMaxAgeHours).sort(), vercel.crons.map(item => item.path).filter(path => path !== '/api/health').sort());
});

test('an unlisted variable in a fixture PR fails the actual source manifest check', async () => {
  const manifest = readManifest();
  const fixture = source => [{ file: 'apps/api/lib/new-feature.ts', source }];
  assert.deepEqual(await checkEnvironmentSources(fixture("const token = process.env['AXIOM_TOKEN']; // process.env.NOT_A_READ"), manifest), []);
  assert.match((await checkEnvironmentSources(fixture('const token = process.env.UNDECLARED_REQUIRED_STORE;'), manifest))[0], /unlisted variable/);
  assert.match((await checkEnvironmentSources(fixture('const token = process.env[computed];'), manifest))[0], /unlisted dynamic/);
  assert.match((await checkEnvironmentSources(fixture('const { UNDECLARED_STORE } = process.env;'), manifest))[0], /UNDECLARED_STORE/);
});

test('the registry-wired CLI rejects an actual fixture checkout with an unlisted required variable', () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-env-manifest-'));
  try {
    mkdirSync(join(root, 'scripts/deploy'), { recursive: true });
    mkdirSync(join(root, 'apps/api/lib'), { recursive: true });
    for (const name of ['env-manifest.mjs', 'env-manifest.json']) {
      copyFileSync(new URL(`../deploy/${name}`, import.meta.url), join(root, 'scripts/deploy', name));
    }
    symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
    assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
    const fixture = join(root, 'apps/api/lib/future.ts');
    writeFileSync(fixture, "const token = process.env['UNLISTED_DEPENDENCY_TOKEN'];\n");
    const failed = spawnSync(process.execPath, ['scripts/deploy/env-manifest.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /unlisted variable UNLISTED_DEPENDENCY_TOKEN/);
    writeFileSync(fixture, "const token = process.env['AXIOM_TOKEN'];\n");
    assert.equal(spawnSync(process.execPath, ['scripts/deploy/env-manifest.mjs'], { cwd: root }).status, 0);
    const registry = readFileSync(new URL('./registry.yml', import.meta.url), 'utf8');
    assert.match(registry, /name: env-manifest\n\s+script: env-manifest.sh\n\s+layer: 1\n\s+blocking: true\n\s+runs: \[local, ci\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('every required environment fails on a missing/blank binding, with names only', () => {
  const manifest = readManifest();
  for (const [target, required] of Object.entries(manifest.required)) {
    const env = Object.fromEntries(required.map(name => [name, 'private-fixture-value']));
    assertRequiredEnvironment(target, env, manifest);
    for (const name of required) {
      assert.throws(() => assertRequiredEnvironment(target, { ...env, [name]: '' }, manifest), error => {
        assert.match(error.message, new RegExp(name));
        assert.doesNotMatch(error.message, /private-fixture-value/);
        return true;
      });
    }
  }
});

test('the scheduled entrypoint consumes provider responses and preserves incidents when a source fails', async () => {
  const external = transport();
  const env = { ...external.context.env, AXIOM_TOKEN: 'private', CRON_SECRET: 'private', VERCEL_TOKEN: 'private',
    POSTHOG_PERSONAL_API_KEY: 'private', POSTHOG_PROJECT_ID: '1', UPSTASH_EMAIL: 'private@example.test',
    UPSTASH_API_KEY: 'private', UPSTASH_DATABASE_ID: 'fixture', UPSTASH_DAILY_COMMAND_LIMIT: '10000' };
  let apiBroken = true, queryDenied = false;
  const store = await loadAlertState(external.context);
  store.state.expiry = { checkedAt: now, certificate: new Date(now + 90 * 86_400_000).toISOString(), domain: new Date(now + 365 * 86_400_000).toISOString() };
  await saveAlertState(store.number, store.state, external.context);
  const fetchImpl = async (url, init = {}) => {
    if (url.startsWith('https://fitsy.org/')) {
      if (url.endsWith('?deep=1')) return Response.json({ status: 'ok', dependencies: { supabase: 'ok', upstash: 'ok', revenuecat: 'ok' } });
      if (url.endsWith('/api/health')) return Response.json({ status: 'ok', db: 'connected', deploymentSha: 'a'.repeat(40) });
      return new Response(null, { status: 401 });
    }
    if (url.includes('api.axiom.co')) {
      if (queryDenied) return new Response(null, { status: 403 });
      const query = JSON.parse(init.body);
      if (query.apl.includes('lastSuccess')) return Response.json(table(Object.keys(policy.cronMaxAgeHours).map(route => ({ route, lastSuccess: new Date(now).toISOString() }))));
      return Response.json(table([row({ errors: apiBroken ? 10 : 0 })]));
    }
    if (url.includes('posthog.com')) return Response.json({ results: [[10, 0, 100, 0, 0]] });
    if (url.includes('api.vercel.com')) return Response.json({ deployments: [{ readyState: 'READY' }] });
    if (url.includes('api.upstash.com')) return Response.json({ daily_net_commands: 10 });
    if (url.endsWith('/commits/main')) return Response.json({ sha: 'a'.repeat(40) });
    return external.context.fetchImpl(url, init);
  };
  assert.ok((await runMonitor({ env, fetchImpl, now })).some(item => item.key === 'api:5xx'));
  assert.equal(external.messages.length, 2);
  queryDenied = true;
  await runMonitor({ env, fetchImpl, now: now + 60_000 });
  assert.equal(external.messages.filter(message => message.text.includes('RESOLVED')).length, 0);
  assert.ok((await loadAlertState(external.context)).state.incidents['api:5xx'].active);
  queryDenied = false; apiBroken = false;
  assert.deepEqual(await runMonitor({ env, fetchImpl, now: now + 120_000 }), []);
  assert.equal(external.messages.filter(message => message.text.includes('RESOLVED') && message.text.includes('api:5xx')).length, 2);
});
