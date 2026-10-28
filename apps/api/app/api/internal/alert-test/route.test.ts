const mockIngest = jest.fn();
jest.mock('@axiomhq/js', () => ({ Axiom: jest.fn(() => ({ ingest: mockIngest, flush: jest.fn(async () => {}) })) }));

import { NextRequest } from 'next/server';
import { GET } from './route';

const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv, CRON_SECRET: 'fixture-cron', AXIOM_TOKEN: 'fixture-token', VERCEL_ENV: 'production' };
  jest.clearAllMocks();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); });
const request = (authenticated: boolean) => new NextRequest('https://fitsy.org/api/internal/alert-test?mode=handled', {
  headers: authenticated ? { authorization: 'Bearer fixture-cron' } : {},
});

test('a deliberate handled 503 exercises the real production alert signal', async () => {
  expect((await GET(request(true))).status).toBe(503);
  expect(mockIngest).toHaveBeenCalledWith('fitsy-pipeline', [expect.objectContaining({
    route: '/api/internal/alert-test', status: 503, alert: true, environment: 'production',
  })]);
});

test('the alert test cannot be triggered without the operator credential', async () => {
  expect((await GET(request(false))).status).toBe(401);
  expect(mockIngest).not.toHaveBeenCalledWith('fitsy-pipeline', [expect.objectContaining({ alert: true })]);
});
