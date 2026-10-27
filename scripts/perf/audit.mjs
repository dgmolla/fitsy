import assert from 'node:assert/strict';

export function percentile(values, fraction) {
  assert.ok(values.length && values.every(value => Number.isFinite(value) && value >= 0), 'need nonnegative finite samples');
  assert.ok(fraction > 0 && fraction <= 1, 'invalid percentile');
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
}

export function summarize(samples) {
  assert.ok(samples.length >= 20, 'at least 20 successful warm samples are required');
  const metric = key => ({ p50: percentile(samples.map(s => s[key]), .5), p95: percentile(samples.map(s => s[key]), .95) });
  return { count: samples.length, totalMs: metric('totalMs'), headersMs: metric('headersMs'), decodedBytes: metric('decodedBytes') };
}

/** Only the stable dev deployment or an explicit loopback server may receive a token. */
export function devOrigin(value) {
  const url = new URL(value);
  const dev = url.protocol === 'https:' && url.hostname === 'dev.fitsy.org' && !url.port;
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  assert.ok((dev || local) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'performance sampling requires https://dev.fitsy.org or an explicit HTTP loopback origin');
  return url.origin;
}

export const getRoutes = [
  'health', 'flags', 'restaurants', 'restaurants/preview', 'restaurants/stats',
  'restaurants/[id]/menu', 'restaurants/shuffle', 'saved-items', 'subscriptions/status', 'user/profile', 'feedback',
];

export function assertRouteCoverage(discovered) {
  assert.deepEqual([...discovered].sort(), [...getRoutes].sort(), 'public GET routes changed; update the performance sampler and its exclusions together');
}

/** Follow actual resolved imports, including indirect imports and cycles. */
export function runtimeAudit(graph) {
  const modules = new Map(graph.modules.map(module => [module.source, module]));
  const reachable = new Set();
  const pending = getRoutes.map(route => `apps/api/app/api/${route}/route.ts`);
  for (const path of pending) assert.ok(modules.has(path), `missing runtime entrypoint: ${path}`);
  while (pending.length) {
    const source = pending.pop();
    if (reachable.has(source)) continue;
    reachable.add(source);
    for (const dependency of modules.get(source)?.dependencies ?? []) {
      assert.ok(!(dependency.couldNotResolve && /^(?:@\/|@fitsy\/|\.)/.test(dependency.module)),
        `unresolved application import: ${source} -> ${dependency.module}`);
      if (dependency.resolved) pending.push(dependency.resolved);
    }
  }
  const providers = [...reachable].filter(path => /(?:@anthropic-ai\/|apps\/api\/services\/(?:macroEstimationService|scrapers\/|menuSources\/|fatsecret|brave|uberEats))/i.test(path));
  return { entrypoints: getRoutes.length, reachableModules: reachable.size, preloadProviders: providers };
}
