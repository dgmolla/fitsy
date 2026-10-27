import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertRouteCoverage, devOrigin, getRoutes, percentile, runtimeAudit, summarize } from './audit.mjs';
import { auditApi, sampleRequest, workloads } from './api.mjs';

test('nearest-rank percentiles use all warm samples and reject unusable measurements', () => {
  const values = Array.from({ length: 20 }, (_, i) => i + 1).reverse();
  assert.equal(percentile(values, .5), 10);
  assert.equal(percentile(values, .95), 19);
  const samples = values.map(n => ({ totalMs: n * 2, headersMs: n, decodedBytes: n * 100 }));
  assert.deepEqual(summarize(samples), { count: 20, totalMs: { p50: 20, p95: 38 },
    headersMs: { p50: 10, p95: 19 }, decodedBytes: { p50: 1000, p95: 1900 } });
  for (const invalid of [[], [NaN], [-1], [Infinity]]) assert.throws(() => percentile(invalid, .5));
  assert.throws(() => summarize(samples.slice(1)));
  for (const invalid of [0, -1, NaN, 1.1]) assert.throws(() => percentile(values, invalid));
});

test('dev sampling refuses production, prefix lookalikes, credentials and remote redirects', async () => {
  for (const value of ['https://fitsy.org', 'https://api.fitsy.org', 'https://dev.fitsy.org.evil.test',
    'https://dev.fitsy.org@evil.test', 'https://dev.fitsy.org:444', 'http://dev.fitsy.org',
    'https://dev.fitsy.org/api', 'https://dev.fitsy.org/?token=secret', 'https://dev.fitsy.org/#x', 'file:///tmp/api']) {
    assert.throws(() => devOrigin(value));
  }
  for (const value of ['https://dev.fitsy.org', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    assert.equal(devOrigin(value), value);
  }
  let calls = 0;
  await assert.rejects(auditApi({ origin: 'https://fitsy.org', token: 'secret', fetcher: async () => { calls++; } }));
  assert.equal(calls, 0);
});

test('request duration includes body loading and bytes are the decoded body size', async () => {
  const body = JSON.stringify({ data: 'café', meta: { locked: false } });
  const ticks = [100, 108, 140];
  const { sample } = await sampleRequest('https://dev.fitsy.org', workloads('id')[0], 'secret', async (_url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer secret');
    return new Response(body, { headers: { 'x-vercel-cache': 'MISS' } });
  }, () => ticks.shift());
  assert.equal(sample.headersMs, 8);
  assert.equal(sample.totalMs, 40);
  assert.equal(sample.decodedBytes, Buffer.byteLength(body));
  assert.equal(sample.vercelCache, 'MISS');
});

test('auth errors, throttling, locked fixtures and non-JSON bodies never become fast samples', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(sampleRequest('https://dev.fitsy.org', workloads('id')[0], 'secret', async () => new Response('{}', { status })));
  }
  for (const body of ['<html>sign in</html>', '{}', '{"meta":{"locked":true}}']) {
    await assert.rejects(sampleRequest('https://dev.fitsy.org', workloads('id')[0], 'secret', async () => new Response(body)));
  }
  const menu = workloads('fixture').find(workload => workload.name === 'menu');
  assert.match(menu.path, /pageSize=200/);
  await sampleRequest('https://dev.fitsy.org', menu, 'secret', async () => new Response('{"data":{"locked":false,"menuItems":[]}}'));
  await assert.rejects(sampleRequest('https://dev.fitsy.org', menu, 'secret', async () => new Response('{"data":{"locked":true,"menuItems":[]}}')));
});

test('all 13 read workloads retain first observations separately, pace requests and redact bodies', async () => {
  const calls = [], pauses = [];
  const report = await auditApi({ origin: 'https://dev.fitsy.org', token: 'secret-token', samples: 20,
    pause: async ms => { pauses.push(ms); }, fetcher: async (url, init) => {
      calls.push({ url, method: init.method });
      return new Response(JSON.stringify(url.includes('/menu?')
        ? { data: { locked: false, menuItems: [] } }
        : { data: [{ id: 'restaurant/a' }], privateEmail: 'private@example.test', meta: { locked: false } }));
    } });
  assert.equal(report.routes.length, 13);
  assert.equal(calls.length, 13 * 21);
  assert.equal(pauses.length, calls.length - 1);
  assert.ok(pauses.every(ms => ms === 650));
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.some(call => call.url.includes('/restaurant%2Fa/menu')));
  assert.ok(report.routes.every(route => route.warm.count === 20 && route.samples.length === 20));
  assert.match(report.coldStart, /unproven/);
  assert.doesNotMatch(JSON.stringify(report), /secret-token|private@example|restaurant%2Fa/);
});

const graph = () => ({ modules: getRoutes.map(route => ({ source: `apps/api/app/api/${route}/route.ts`, dependencies: [] })) });
test('new or removed public GET routes cannot silently escape the sampling inventory', () => {
  assertRouteCoverage([...getRoutes].reverse());
  assert.throws(() => assertRouteCoverage([...getRoutes, 'new-data-route']));
  assert.throws(() => assertRouteCoverage(getRoutes.slice(1)));
});
test('runtime cost budget follows transitive imports and rejects unresolved local aliases', () => {
  const clean = graph();
  assert.deepEqual(runtimeAudit(clean), { entrypoints: 10, reachableModules: 10, preloadProviders: [] });
  clean.modules[0].dependencies.push({ module: '@/lib/helper', resolved: 'apps/api/lib/helper.ts' });
  clean.modules.push({ source: 'apps/api/lib/helper.ts', dependencies: [
    { resolved: clean.modules[0].source }, { resolved: 'apps/api/services/macroEstimationService.ts' },
  ] });
  assert.deepEqual(runtimeAudit(clean).preloadProviders, ['apps/api/services/macroEstimationService.ts']);
  clean.modules[0].dependencies.push({ module: '@/lib/unknown', couldNotResolve: true });
  assert.throws(() => runtimeAudit(clean), /unresolved application import/);
  assert.throws(() => runtimeAudit({ modules: [] }), /missing runtime entrypoint/);
});
