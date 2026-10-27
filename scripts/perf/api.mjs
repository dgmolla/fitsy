import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devOrigin, summarize } from './audit.mjs';

const area = 'lat=34.0407&lng=-118.2468';
const targets = 'calories=600&protein=40&carbs=60&fat=20';
export function workloads(restaurantId) {
  return [
    { name: 'restaurants', path: `/api/restaurants?${area}&${targets}&limit=20`, lockedAt: 'meta' },
    { name: 'restaurants-text', path: `/api/restaurants?${area}&${targets}&q=chicken&limit=20`, lockedAt: 'meta' },
    { name: 'preview-guided', path: `/api/restaurants/preview?${area}&${targets}&guided=1` },
    { name: 'preview-legacy', path: `/api/restaurants/preview?${area}&${targets}` },
    { name: 'menu', path: `/api/restaurants/${encodeURIComponent(restaurantId)}/menu?${targets}&pageSize=200`, lockedAt: 'data' },
    { name: 'shuffle', path: `/api/restaurants?shuffle=1&${area}&${targets}&seed=perf-audit`, lockedAt: 'meta' },
    ...['health', 'flags', 'restaurants/stats', 'saved-items', 'subscriptions/status', 'user/profile', 'feedback']
      .map(name => ({ name, path: `/api/${name}` })),
  ];
}

/** No bodies, tokens, user IDs or Vercel request IDs are retained in the receipt. */
export async function sampleRequest(origin, workload, token, fetcher = fetch, now = () => performance.now()) {
  origin = devOrigin(origin);
  const started = now();
  const response = await fetcher(origin + workload.path, {
    method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  const headersMs = now() - started;
  const buffer = Buffer.from(await response.arrayBuffer());
  const totalMs = now() - started;
  assert.equal(response.status, 200, `${workload.name}: expected HTTP 200, received ${response.status}`);
  const body = JSON.parse(buffer.toString('utf8'));
  assert.ok(body && typeof body === 'object' && !body.error, `${workload.name}: invalid JSON success response`);
  if (workload.lockedAt) assert.equal(body[workload.lockedAt]?.locked, false, `${workload.name}: requires an entitled dev fixture`);
  return { body, sample: { totalMs, headersMs, decodedBytes: buffer.length,
    cacheControl: response.headers.get('cache-control'), vercelCache: response.headers.get('x-vercel-cache'),
    serverTiming: response.headers.get('server-timing') } };
}

export async function auditApi({ origin, token, samples = 20, fetcher = fetch, pause = delay, progress = () => {} }) {
  origin = devOrigin(origin);
  assert.ok(typeof token === 'string' && token.trim(), 'FITSY_PERF_TOKEN must contain an entitled dev account JWT');
  assert.ok(Number.isInteger(samples) && samples >= 20 && samples <= 29, 'samples must be 20-29 (including the first observation stays within 30/minute)');
  // 650 ms between every request stays below the shared 120/user/minute cap.
  // Stop on 401/403/429 or transport failures; retries would distort the distribution.
  const firstWorkload = workloads('pending')[0];
  const first = await sampleRequest(origin, firstWorkload, token, fetcher);
  assert.ok(first.body.data?.[0]?.id, 'dev fixture must have nearby restaurants');
  const definitions = workloads(first.body.data[0].id);
  const routes = [];
  for (const workload of definitions) {
    progress(workload.name);
    let initial = first.sample;
    if (workload !== definitions[0]) {
      await pause(650);
      initial = (await sampleRequest(origin, workload, token, fetcher)).sample;
    }
    const warm = [];
    for (let i = 0; i < samples; i++) {
      await pause(650);
      warm.push((await sampleRequest(origin, workload, token, fetcher)).sample);
    }
    routes.push({ name: workload.name, firstObservedRequest: initial, warm: summarize(warm), samples: warm });
  }
  return { version: 1, measuredAt: new Date().toISOString(), origin, routes,
    sourceIdentity: 'unverified: retain the deployed dev revision and fixture identity separately before comparing runs',
    coldStart: 'unproven: first observed request and x-vercel-cache do not establish a function cold start',
    payload: 'decoded response body bytes, not compressed wire bytes', timingBudgets: 'observational only' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  auditApi({ origin: process.env.FITSY_PERF_ORIGIN ?? 'https://dev.fitsy.org', token: process.env.FITSY_PERF_TOKEN,
    progress: route => process.stderr.write(`Sampling ${route}\n`) })
    .then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n'))
    .catch(error => {
      // Fetch/JSON errors can contain URLs or response fragments. Never echo them.
      process.stderr.write(error.code === 'ERR_ASSERTION' ? error.message + '\n' : 'API sampling failed; check dev connectivity and fixture credentials.\n');
      process.exitCode = 1;
    });
}
