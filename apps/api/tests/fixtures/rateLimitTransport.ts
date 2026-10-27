/** Fixture for the external Upstash REST boundary; internal limiters stay real. */
export function useRateLimitTransport() {
  const transport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const originalEnv = { ...process.env };
  let spy: jest.SpyInstance;
  beforeEach(() => {
    process.env['UPSTASH_REDIS_REST_URL'] = 'https://quota.example.test';
    process.env['UPSTASH_REDIS_REST_TOKEN'] = 'fixture-token';
    transport.mockReset().mockImplementation(async () => Response.json({ result: [1, 0, 0] }));
    spy = jest.spyOn(global, 'fetch').mockImplementation(transport);
  });
  afterEach(() => {
    spy.mockRestore();
    process.env = { ...originalEnv };
  });
  return transport;
}
