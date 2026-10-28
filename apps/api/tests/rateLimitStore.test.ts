import { consumeSharedQuota, SLIDING_WINDOW_SCRIPT, STORE_TIMEOUT_MS } from '../services/rateLimitStore';
import { useRateLimitTransport } from './fixtures/rateLimitTransport';
import { createRateLimiter, rateLimitResponse } from '../lib/rateLimit';

const transport = useRateLimitTransport();
const policy = { namespace: 'test-store', max: 3, windowMs: 60_000, maxKeys: 2 };

test('uses one atomic script, hashed stable identities, separate namespaces and unique request members', async () => {
  await consumeSharedQuota(policy, '192.0.2.1');
  await consumeSharedQuota(policy, '192.0.2.1');
  await consumeSharedQuota({ ...policy, namespace: 'other' }, '192.0.2.1');
  const commands = transport.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(commands[0]).toEqual(['EVAL', SLIDING_WINDOW_SCRIPT, '2', 'fitsy:rate-limit:v1:{test-store}:identities',
    expect.stringMatching(/^fitsy:rate-limit:v1:\{test-store\}:[a-f0-9]{64}$/), '60000', '3', '2',
    expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(String)]);
  expect(commands[0][4]).toBe(commands[1][4]);
  expect(commands[0][9]).not.toBe(commands[1][9]);
  expect(commands[0][4]).not.toBe(commands[2][4]);
  expect(JSON.stringify(commands)).not.toContain('192.0.2.1');
  expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store',
    headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, signal: expect.any(AbortSignal) });
});

test.each([
  [new Response('', { status: 503 })], [Response.json({ error: 'provider error' })],
  [Response.json({ result: [1, 3, 0] })], [Response.json({ result: [0, 1, 100] })],
  [Response.json({ result: [0, 0, 0] })], [Response.json({ result: [1, 0, 10] })],
  [Response.json({ result: [1, 0, 0, 0] })], [Response.json({ result: [1, '1', 0] })],
  [Response.json({ result: [0, 0, 60_001] })], [new Response('{bad json')],
])('fails closed on store failures or invalid responses %#', async response => {
  transport.mockResolvedValueOnce(response);
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = await createRateLimiter(policy).check('user');
    expect(result).toMatchObject({ ok: false, unavailable: true });
    const denied = rateLimitResponse(result);
    expect(denied.status).toBe(503);
    expect(denied.headers.get('Retry-After')).toBe('1');
    expect(denied.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await denied.json()).toEqual({ error: 'Service unavailable' });
    expect(transport).toHaveBeenCalledTimes(1);
  } finally { log.mockRestore(); }
});

test.each(['request', 'body'])('bounds a hung %s, aborts and does not retry or fall back', async phase => {
  jest.useFakeTimers();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const never = new Promise<never>(() => {});
    if (phase === 'request') transport.mockReturnValueOnce(never);
    else {
      const response = Response.json({});
      jest.spyOn(response, 'json').mockReturnValue(never);
      transport.mockResolvedValueOnce(response);
    }
    const pending = createRateLimiter(policy).check('user');
    await jest.advanceTimersByTimeAsync(STORE_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, unavailable: true });
    expect(transport.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally { log.mockRestore(); jest.useRealTimers(); }
});

test.each(['production', 'preview'])('missing store credentials fail closed in %s', async environment => {
  delete process.env['UPSTASH_REDIS_REST_URL'];
  delete process.env['UPSTASH_REDIS_REST_TOKEN'];
  process.env['VERCEL_ENV'] = environment;
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await createRateLimiter(policy).check('user')).toMatchObject({ ok: false, unavailable: true });
    expect(transport).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test.each(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'])('partial configuration cannot enable a local fallback: %s', async missing => {
  delete process.env[missing];
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const limiter = createRateLimiter(policy);
    expect(await limiter.check('private-identity')).toMatchObject({ ok: false, unavailable: true });
    expect(await limiter.check('private-identity')).toMatchObject({ ok: false, unavailable: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-identity');
    expect(transport).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

test.each(['http://quota.example.test', 'not-a-url-private-value', 'https://user:password@quota.example.test',
  'https://quota.example.test?token=secret', 'https://quota.example.test#private-value'])('rejects unsafe store URL %s before transmission', async url => {
  process.env['UPSTASH_REDIS_REST_URL'] = url;
  await expect(consumeSharedQuota(policy, 'user')).rejects.toThrow('invalid rate limit store URL');
  expect(transport).not.toHaveBeenCalled();
});

test.each([' ', '\n', 'fixture-token\n'])('invalid store tokens fail closed before transmission %#', async token => {
  process.env['UPSTASH_REDIS_REST_TOKEN'] = token;
  await expect(consumeSharedQuota(policy, 'user')).rejects.toThrow('rate limit store is not configured');
  expect(transport).not.toHaveBeenCalled();
});

test('rounds a genuine quota Retry-After up and keeps it private', async () => {
  transport.mockImplementationOnce(async () => Response.json({ result: [0, 0, 1501] }));
  const response = rateLimitResponse(await createRateLimiter(policy).check('user'));
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('2');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ error: 'Too many requests' });
});
