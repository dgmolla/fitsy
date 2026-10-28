const mockIngest = jest.fn();
const mockFlush = jest.fn(async () => {});
jest.mock('@axiomhq/js', () => ({ Axiom: jest.fn(() => ({ ingest: mockIngest, flush: mockFlush })) }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET as status } from './subscriptions/status/route';
import { GET as restaurants } from './restaurants/route';
import { POST as login } from './auth/login/route';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, VERCEL_ENV: 'production', AXIOM_TOKEN: 'fixture-token' };
  delete process.env['UPSTASH_REDIS_REST_URL'];
  delete process.env['UPSTASH_REDIS_REST_TOKEN'];
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); });

test.each([
  ['/api/subscriptions/status', 'GET', status],
  ['/api/restaurants', 'GET', restaurants],
  ['/api/auth/login', 'POST', login],
] as const)('the Oct 27 missing-store outage emits an alert signal for %s', async (route, method, handler) => {
  const response = await handler(new NextRequest(`https://fitsy.org${route}?private=do-not-log`, {
    method, headers: { authorization: 'Bearer private-token', 'x-forwarded-for': 'private-ip' },
  }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Service unavailable' });
  expect(mockIngest).toHaveBeenCalledWith('fitsy-pipeline', [expect.objectContaining({
    type: 'api_request', method, route, status: 503, alert: true, environment: 'production',
    durationMs: expect.any(Number),
  })]);
  expect(JSON.stringify(mockIngest.mock.calls)).not.toMatch(/private-token|private-ip|do-not-log/);
});
