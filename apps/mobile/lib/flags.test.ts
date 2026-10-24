import type * as Flags from './flags';

let flags: typeof Flags;
const originalFetch = global.fetch;
const originalEnv = process.env;
beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers().setSystemTime(0);
  process.env = { ...originalEnv, EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.example.test', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key' };
  flags = await import('./flags');
});
afterEach(() => { global.fetch = originalFetch; process.env = originalEnv; jest.useRealTimers(); });

function respond(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body });
}

test.each([undefined, '', 'false', '0', '1', 'TRUE', ' true ', 'true'])('bundled EXPO_PUBLIC_FLAG_*=%s defaults OFF except literal true', value => {
  expect(flags.isFlagEnabled('TEST', value)).toBe(value === 'true');
  expect(flags.isFlagEnabled('UNKNOWN')).toBe(false);
  expect(flags.isFlagEnabled('toString', value)).toBe(false);
});

test('remote override is optional; true and false take precedence, missing keys use bundled defaults', async () => {
  respond({ TEST: true, OFF: false });
  expect(flags.isFlagEnabled('TEST')).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
  await flags.refreshFlags();
  expect(global.fetch).toHaveBeenCalledWith(
    `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/flags`,
    expect.objectContaining({ headers: {}, signal: expect.any(AbortSignal) }),
  );
  expect(flags.isFlagEnabled('TEST')).toBe(true);
  expect(flags.isFlagEnabled('OFF', 'true')).toBe(false);
  expect(flags.isFlagEnabled('MISSING', 'true')).toBe(true);
});

test('coalesces requests, caches for 60 seconds, then expires ON and refreshes without a rebuild', async () => {
  respond({ TEST: true });
  await Promise.all([flags.refreshFlags(), flags.refreshFlags()]);
  await flags.refreshFlags();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  jest.setSystemTime(60_000);
  expect(flags.isFlagEnabled('TEST')).toBe(false);
  respond({ TEST: false });
  await flags.refreshFlags();
  expect(flags.isFlagEnabled('TEST', 'true')).toBe(false);
});

test.each([null, [], { TEST: 'true' }, { TEST: 1 }, { test: true }])('malformed remote flags fall back to bundled values: %j', async body => {
  respond(body);
  await flags.refreshFlags();
  expect(flags.isFlagEnabled('TEST')).toBe(false);
  expect(flags.isFlagEnabled('TEST', 'true')).toBe(true);
});

test.each(['network', 'http', 'json'])('%s failure clears expired remote flags and retries after the cache interval', async failure => {
  respond({ TEST: true });
  await flags.refreshFlags();
  jest.setSystemTime(60_000);
  respond({}, false);
  if (failure === 'network') (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
  if (failure === 'json') respond(Promise.reject(new Error('bad JSON')));
  await flags.refreshFlags();
  expect(flags.isFlagEnabled('TEST')).toBe(false);
  await flags.refreshFlags();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  jest.setSystemTime(120_000);
  respond({ TEST: true });
  await flags.refreshFlags();
  expect(flags.isFlagEnabled('TEST')).toBe(true);
});

test('aborts a stalled remote read after three seconds and stays OFF', async () => {
  global.fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const refresh = flags.refreshFlags();
  await jest.advanceTimersByTimeAsync(3000);
  await refresh;
  expect(flags.isFlagEnabled('TEST')).toBe(false);
});
