import { fetchStoreV1, fetchFeedV1, paginateFeedV1, UeRateLimitError, __resetUeCircuitBreakerForTest } from '../../apps/api/services/menuSources/ueApiClient';
import { SharedUeRateLimiter } from './ue-rate-limiter';

// Only external PostgreSQL/HTTP and clocks are substituted; admission and transport are real.
const query = jest.fn(), http = jest.spyOn(global, 'fetch');
const state = { capRps: 1, effectiveRps: 0.5, blockedUntil: new Date('2026-10-28T12:01:00Z'), throttles: 1n };
const limiter = () => new SharedUeRateLimiter({ $queryRaw: query });
beforeEach(() => { query.mockReset(); http.mockReset(); __resetUeCircuitBreakerForTest(); });
afterEach(() => { jest.useRealTimers(); delete process.env['UE_LOC_COOKIE']; });
afterAll(() => http.mockRestore());

test('every attempt, including retries and feed requests, consumes the shared bucket', async () => {
  query.mockResolvedValue([{ allowed: true, waitMs: 0 }]);
  http.mockResolvedValueOnce(new Response('temporary', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: 'success' }))
    .mockResolvedValueOnce(Response.json({ status: 'success' }));
  const gate = limiter();
  await fetchStoreV1('fixture', { rateLimiter: gate, maxRetries: 1, baseBackoffMs: 0 });
  process.env['UE_LOC_COOKIE'] = encodeURIComponent('{}');
  await fetchFeedV1(34.05, -118.25, { rateLimiter: gate });
  expect(http).toHaveBeenCalledTimes(3); expect(query).toHaveBeenCalledTimes(3);
  for (let i = 0; i < 3; i++) expect(query.mock.invocationCallOrder[i]).toBeLessThan(http.mock.invocationCallOrder[i]!);
});

test('each feed page goes through admission', async () => {
  query.mockResolvedValue([{ allowed: true, waitMs: 0 }]);
  process.env['UE_LOC_COOKIE'] = encodeURIComponent('{}');
  http.mockResolvedValueOnce(Response.json({ data: { feedItems: [{ type: 'REGULAR_STORE', store: {
    storeUuid: 'one', title: { text: 'Fixture' }, mapMarker: { latitude: 34.05, longitude: -118.25 },
  } }] } })).mockResolvedValueOnce(Response.json({ data: { feedItems: [] } }));
  const stores = [];
  for await (const store of paginateFeedV1(34.05, -118.25, { rateLimiter: limiter() })) stores.push(store);
  expect(stores).toHaveLength(1); expect(query).toHaveBeenCalledTimes(2); expect(http).toHaveBeenCalledTimes(2);
});

test.each([403, 429] as const)('HTTP %s persists global backoff even on the final attempt and logs safe metrics', async status => {
  query.mockResolvedValueOnce([{ allowed: true, waitMs: 0 }]).mockResolvedValueOnce([state]);
  http.mockResolvedValue(new Response('private provider body', { status, headers: { 'Retry-After': '120' } }));
  const logs = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await fetchStoreV1('fixture', { maxRetries: 0, rateLimiter: limiter() })).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![0].join('')).toContain('throttles = s.throttles + 1');
    const event = logs.mock.calls.map(([line]) => String(line)).find(line => line.startsWith('{'))!;
    expect(JSON.parse(event)).toMatchObject({ event: 'ue_throttle', status, effectiveRps: 0.5, throttles: '1' });
    expect(event).not.toContain('private');
  } finally { logs.mockRestore(); }
});

test('a failed shared backoff write fails closed without a transport retry', async () => {
  query.mockResolvedValueOnce([{ allowed: true, waitMs: 0 }]).mockRejectedValueOnce(new Error('database unavailable'));
  http.mockResolvedValue(new Response('throttled', { status: 429 }));
  await expect(fetchStoreV1('fixture', { rateLimiter: limiter(), maxRetries: 2 })).rejects.toBeInstanceOf(UeRateLimitError);
  expect(http).toHaveBeenCalledTimes(1);
});

test('missing or unavailable limiter state never falls back to unthrottled HTTP', async () => {
  query.mockResolvedValueOnce([]);
  await expect(fetchStoreV1('fixture', { rateLimiter: limiter() })).rejects.toThrow('limiter state missing');
  query.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(fetchStoreV1('fixture', { rateLimiter: limiter() })).rejects.toThrow('database unavailable');
  expect(http).not.toHaveBeenCalled();
});

test('waiting does not consume the HTTP timeout and losing a lease cancels the wait before transport', async () => {
  jest.useFakeTimers();
  query.mockResolvedValue([{ allowed: false, waitMs: 30_000 }]);
  const controller = new AbortController();
  const pending = fetchStoreV1('fixture', { rateLimiter: limiter(), timeoutMs: 10, signal: controller.signal });
  await jest.advanceTimersByTimeAsync(100);
  expect(http).not.toHaveBeenCalled();
  controller.abort();
  expect(await pending).toBeNull();
  expect(query).toHaveBeenCalledTimes(1); expect(http).not.toHaveBeenCalled();
});

test('the HTTP timeout starts only after a long admission wait', async () => {
  jest.useFakeTimers();
  query.mockResolvedValueOnce([{ allowed: false, waitMs: 1000 }]).mockResolvedValueOnce([{ allowed: true, waitMs: 0 }]);
  http.mockResolvedValueOnce(Response.json({ status: 'success' }));
  const pending = fetchStoreV1('fixture', { rateLimiter: limiter(), timeoutMs: 10 });
  await jest.advanceTimersByTimeAsync(1001);
  expect(await pending).toEqual({ status: 'success' });
  const init = http.mock.calls[0]![1]!;
  expect(init.signal?.aborted).toBe(false);
});
