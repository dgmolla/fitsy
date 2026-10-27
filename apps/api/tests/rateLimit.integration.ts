import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { WorkerRequest } from './fixtures/rateLimitWorker';
import { quotaService } from './fixtures/quotaService';

const exec = promisify(execFile);
const live = process.env['FITSY_TEST_REAL_REDIS'] === '1';
interface Worker {
  call(request: WorkerRequest): Promise<WorkerResult>;
  stop(): Promise<void>;
}
const workers: Worker[] = [];
let container: string | undefined;
let storeUnavailable = false;
// Independent reference service for deterministic tests of the REST boundary.
// The live lane runs these same journeys against the actual production Lua.
const service = quotaService();
async function command(args: string[]): Promise<number[]> {
  if (storeUnavailable) throw new Error('simulated external store outage');
  if (live) {
    const output = await exec('docker', ['exec', container!, 'redis-cli', '--json', ...args], { timeout: 5_000 });
    const result: unknown = JSON.parse(output.stdout);
    if (!Array.isArray(result)) throw new Error('Redis command failed');
    return result as number[];
  }
  return service.command(args);
}

interface WorkerResult {
  status: number;
  ok: boolean;
  unavailable?: boolean;
  retryAfterMs: number;
  headers: Record<string, string>;
  body: unknown;
}
async function worker(trusted = true): Promise<Worker> {
  const child = fork(resolve(__dirname, 'fixtures/rateLimitWorker.ts'), [], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, TSX_TSCONFIG_PATH: resolve(__dirname, '../tsconfig.json'),
      NODE_ENV: 'test', VERCEL: trusted ? '1' : '0', VERCEL_ENV: 'preview',
      UPSTASH_REDIS_REST_URL: 'https://quota.example.test', UPSTASH_REDIS_REST_TOKEN: 'fixture-token',
      SUPABASE_URL: 'https://fixture.supabase.test', POSTGRES_PRISMA_URL: 'invalid-quota-test-sentinel' },
  });
  const requests = new Map<string, { resolve: (value: WorkerResult) => void; reject: (error: Error) => void }>();
  let ready: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  child.on('message', (message: { kind: string; id: string; command?: string[]; result?: WorkerResult; error?: string }) => {
    if (message.kind === 'ready') { ready(); return; }
    if (message.kind === 'store') {
      command(message.command!).then(result => {
        if (child.connected) child.send({ kind: 'store-reply', id: message.id, result });
      }, () => {
        if (child.connected) child.send({ kind: 'store-reply', id: message.id, error: 'fixture store unavailable' });
      });
      return;
    }
    const request = requests.get(message.id)!;
    if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result!);
    requests.delete(message.id);
  });
  child.on('exit', () => {
    for (const request of requests.values()) request.reject(new Error('worker stopped'));
    requests.clear();
  });
  const startup = setTimeout(() => child.kill(), 10_000);
  try { await Promise.race([started, new Promise<never>((_, reject) => child.once('exit', () => reject(new Error('worker startup failed'))))]); }
  finally { clearTimeout(startup); }
  const instance = {
    async call(request: WorkerRequest): Promise<WorkerResult> {
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        requests.set(id, { resolve, reject });
        child.send({ kind: 'request', id, request });
      });
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill();
      await ended;
    },
  };
  workers.push(instance);
  return instance;
}

before(async () => {
  if (live) {
    const result = await exec('docker', ['run', '--detach', '--rm', '--network', 'none',
      '--label', 'org.fitsy.fixture=rate-limits', '--name', `fitsy-quota-${randomUUID()}`, 'redis:7.4-alpine',
      'redis-server', '--save', '', '--appendonly', 'no', '--maxmemory', '32mb', '--maxmemory-policy', 'noeviction'], { timeout: 60_000 });
    assert.match(result.stdout.trim(), /^[a-f0-9]{64}$/);
    container = result.stdout.trim();
    // redis-cli connects only inside the owned, network-isolated container.
    for (let attempt = 0; ; attempt++) {
      try {
        const ping = await exec('docker', ['exec', container, 'redis-cli', 'PING'], { timeout: 5_000 });
        assert.equal(ping.stdout.trim(), 'PONG');
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
});
beforeEach(async () => {
  storeUnavailable = false;
  service.clear();
  if (container) await exec('docker', ['exec', container, 'redis-cli', 'FLUSHDB'], { timeout: 5_000 });
});
afterEach(async () => { await Promise.all(workers.splice(0).map(instance => instance.stop())); });
after(async () => {
  await Promise.all(workers.map(instance => instance.stop()));
  if (container) await exec('docker', ['rm', '--force', container], { timeout: 10_000 });
});
const headers = (ip = '192.0.2.1', forged = '198.51.100.1') => ({
  'x-vercel-forwarded-for': ip, 'x-forwarded-for': forged, 'x-real-ip': forged,
});

test(`auth quotas survive separate workers, provider changes and cold starts (${live ? 'real Redis' : 'REST fixture'})`, async () => {
  const a = await worker(), b = await worker();
  const routes = ['apple', 'google', 'login', 'register'] as const;
  for (let i = 0; i < 10; i++) {
    assert.equal((await (i % 2 ? a : b).call({ route: routes[i % 4]!, headers: headers('192.0.2.1', `198.51.100.${i}`) })).status, 400);
  }
  await a.stop();
  const cold = await worker();
  const denied = await cold.call({ route: 'apple', headers: headers('192.0.2.1', '198.51.100.99') });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers['retry-after']) > 0);
  assert.equal(denied.headers['cache-control'], 'private, no-store');
  assert.equal((await b.call({ route: 'apple', headers: headers('192.0.2.2') })).status, 400);
});

test('untrusted hosts ignore forged headers even across independent workers', async () => {
  const a = await worker(false), b = await worker(false);
  for (let i = 0; i < 11; i++) {
    assert.equal((await (i % 2 ? a : b).call({ route: 'google', headers: headers(`192.0.2.${i}`, `198.51.100.${i}`) })).status, i < 10 ? 400 : 429);
  }
});

test('public waitlist quotas are shared and do not trust alternative forwarding headers', async () => {
  const a = await worker(), b = await worker();
  for (let i = 0; i < 6; i++) {
    assert.equal((await (i % 2 ? a : b).call({ route: 'waitlist', headers: headers('192.0.2.3', `198.51.100.${i}`) })).status, i < 5 ? 200 : 429);
  }
});

test('store outages fail closed at real auth, public and data consumers, then recover', async () => {
  const a = await worker(), b = await worker();
  storeUnavailable = true;
  for (const route of ['apple', 'google', 'login', 'register', 'waitlist', 'data'] as const) {
    const denied = await a.call({ route, user: 'same-account', headers: headers() });
    assert.equal(denied.status, 503, route);
    assert.deepEqual(denied.body, { error: 'Service unavailable' });
    assert.equal(denied.headers['retry-after'], '1');
    assert.equal(denied.headers['cache-control'], 'private, no-store');
  }
  assert.equal((await b.call({ route: 'data' })).status, 401);
  storeUnavailable = false;
  assert.equal((await b.call({ route: 'apple', headers: headers() })).status, 400);
  assert.equal((await a.call({ route: 'data', user: 'same-account', headers: headers() })).status, 200);
});

test('verified user quotas span workers, refreshed credentials and changing IPs; authentication stays required', async () => {
  const a = await worker(), b = await worker();
  assert.equal((await a.call({ route: 'data' })).status, 401);
  for (let i = 0; i < 121; i++) {
    assert.equal((await (i % 2 ? a : b).call({ route: 'data', user: 'same-account', headers: headers(`192.0.2.${i}`) })).status, i < 120 ? 200 : 429);
  }
  assert.equal((await b.call({ route: 'data', user: 'other-account', headers: headers('192.0.2.200') })).status, 200);
  assert.equal((await b.call({ route: 'data' })).status, 401);
});

test('concurrent admission, namespace isolation, bounded identities and TTL recovery', async () => {
  const a = await worker(), b = await worker();
  const quota = { namespace: 'concurrency', windowMs: 60_000, max: 3, maxKeys: 2 };
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).call({ route: 'quota', quota, user: 'first' })));
  assert.equal(results.filter(result => result.ok).length, 3);
  assert.equal((await a.call({ route: 'quota', quota, user: 'second' })).ok, true);
  assert.equal((await b.call({ route: 'quota', quota, user: 'third' })).ok, false);
  assert.equal((await b.call({ route: 'quota', quota, user: 'first' })).ok, false);
  assert.equal((await a.call({ route: 'quota', quota: { ...quota, namespace: 'separate' }, user: 'first' })).ok, true);
  const expiring = { namespace: 'expires', windowMs: 2_000, max: 1, maxKeys: 1 };
  assert.equal((await a.call({ route: 'quota', quota: expiring, user: 'old' })).ok, true);
  assert.equal((await b.call({ route: 'quota', quota: expiring, user: 'new' })).ok, false);
  await new Promise(resolve => setTimeout(resolve, 2_100));
  assert.equal((await b.call({ route: 'quota', quota: expiring, user: 'new' })).ok, true);
});
