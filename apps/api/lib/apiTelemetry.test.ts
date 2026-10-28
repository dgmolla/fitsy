const mockIngest = jest.fn();
const mockFlush = jest.fn(async () => {});
jest.mock('@axiomhq/js', () => ({ Axiom: jest.fn(() => ({ ingest: mockIngest, flush: mockFlush })) }));

import { withApiTelemetry } from './apiTelemetry';
let errorLog: jest.SpyInstance;

beforeEach(() => {
  process.env['AXIOM_TOKEN'] = 'fixture';
  jest.clearAllMocks();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { delete process.env['AXIOM_TOKEN']; jest.restoreAllMocks(); });

test.each([200, 401, 429, 500, 503])('records status %s and preserves the exact response', async status => {
  const response = new Response('unchanged', { status });
  const handler = withApiTelemetry('GET', '/api/fixture/[id]', async (id: string) => {
    expect(id).toBe('private-account-id');
    return response;
  });
  expect(await handler('private-account-id')).toBe(response);
  expect(mockIngest).toHaveBeenCalledWith('fitsy-pipeline', [expect.objectContaining({
    status, route: '/api/fixture/[id]', durationMs: expect.any(Number), alert: status >= 500,
  })]);
  expect(JSON.stringify(mockIngest.mock.calls)).not.toContain('private-account-id');
  expect(mockFlush).toHaveBeenCalled();
});

test('uncaught errors report 500 while preserving the original throw', async () => {
  const error = new Error('private provider body');
  const handler = withApiTelemetry('POST', '/api/fixture', async () => { throw error; });
  await expect(handler()).rejects.toBe(error);
  expect(mockIngest).toHaveBeenCalledWith('fitsy-pipeline', [expect.objectContaining({ status: 500, alert: true })]);
  expect(JSON.stringify(mockIngest.mock.calls)).not.toContain(error.message);
});

test('telemetry failure cannot replace or delay the product response', async () => {
  mockIngest.mockImplementationOnce(() => { throw new Error('private-ingest-error'); });
  const handler = withApiTelemetry('GET', '/api/fixture', async () => new Response(null, { status: 503 }));
  expect((await handler()).status).toBe(503);
  expect(errorLog).toHaveBeenCalledWith('[api-emitter] telemetry recording failed');
});
