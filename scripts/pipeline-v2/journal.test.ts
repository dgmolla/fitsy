import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { V2Journal, reservationUsd } from './journal';
import { coarseRequest } from '../eval/suite/adapters';
import type { JevRequest } from '../eval/lib/jev-experiment';

const identity = { runId: 'run', hexId: 'hex', target: 'dev' };
const request = coarseRequest({ chain: 'Test Kitchen', name: 'Chicken rice bowl', section: 'Mains', description: '', region: 'CA', serving: 'one bowl' });
const dirs: string[] = [], journals: V2Journal[] = [];
function open(path?: string, cap = 5) {
  if (!path) { const dir = mkdtempSync(join(tmpdir(), 'v2-journal-')); dirs.push(dir); path = join(dir, 'journal.jsonl'); }
  const j = new V2Journal(path, identity, cap); journals.push(j); return j;
}
function body(req: JevRequest, patch: Record<string, unknown> = {}) {
  return JSON.stringify({ model: 'jev-1.14.0', usage: { input_tokens: 100, output_tokens: 20 }, answers: Object.fromEntries(
    Object.entries(req.questions).map(([name, q]) => [name, { type: 'choice', choice: 'b1', confidence: .9,
      probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, key === 'b1' ? 1 : 0])) }])) , ...patch });
}
beforeEach(() => { process.env['TYPESAFE_API_KEY'] = 'test-secret-do-not-retain'; });
afterEach(() => { jest.restoreAllMocks(); delete process.env['TYPESAFE_API_KEY']; journals.splice(0).forEach(j => j.close()); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });

test('charges reported usage once and replays identical paid requests across resume', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body(request)));
  const j = open(); await j.send(request); const path = j.path, cost = j.knownUsd; j.close();
  const resumed = open(path); await resumed.send(request);
  expect(resumed.knownUsd).toBe(cost); expect(resumed.requests).toBe(1); expect(resumed.reusedRequests).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', expect.objectContaining({ redirect: 'error', method: 'POST' }));
  expect(readFileSync(path, 'utf8')).not.toContain(process.env['TYPESAFE_API_KEY']);
});
test('reserves the worst-case request before spending and cannot reset the cap on resume', async () => {
  const fetcher = jest.spyOn(global, 'fetch'), j = open(undefined, reservationUsd / 2);
  await expect(j.send(request)).rejects.toThrow('spend cap'); expect(fetcher).not.toHaveBeenCalled();
  const path = j.path; j.close(); expect(() => open(path, 5)).toThrow('identity, protocol or cap');
});
test.each([{ usage: undefined }, { usage: { input_tokens: -1, output_tokens: 0 } }])('unknown usage blocks further requests and resume', async patch => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body(request, patch))), j = open();
  await expect(j.send(request)).rejects.toThrow('Unknown Jev usage'); const path = j.path; j.close();
  const resumed = open(path); await expect(resumed.send(request)).rejects.toThrow('Unknown Jev usage');
  expect(fetcher).toHaveBeenCalledTimes(1); expect(resumed.unknown).toBe(true);
});
test('accounts billed HTTP failures without a retry', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body(request), { status: 429 })), j = open();
  await expect(j.send(request)).rejects.toThrow('HTTP 429'); expect(j.knownUsd).toBeCloseTo(100 * .042 / 1e6);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('a transport interruption leaves unknown spend and redacts exception details', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error(process.env['TYPESAFE_API_KEY'])); const j = open();
  await expect(j.send(request)).rejects.toThrow('usage unknown');
  expect(readFileSync(j.path, 'utf8')).not.toContain(process.env['TYPESAFE_API_KEY']);
  const path = j.path; j.close(); expect(open(path).unknown).toBe(true);
});
test('provider credential echoes are redacted before durable storage', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body(request, { detail: process.env['TYPESAFE_API_KEY'] }))); const j = open();
  await expect(j.send(request)).rejects.toThrow('Unknown Jev usage');
  expect(readFileSync(j.path, 'utf8')).not.toContain(process.env['TYPESAFE_API_KEY']);
});
test('rejects a model drift and accounts the invalid response', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body(request, { model: 'jev-other' }))); const j = open();
  await expect(j.send(request)).rejects.toThrow('model drift'); expect(j.knownUsd).toBeGreaterThan(0);
});
test('a different menu item cannot bypass a retained model-drift stop', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body(request, { model: 'jev-other' }))); const j = open();
  await expect(j.send(request)).rejects.toThrow('model drift'); const path = j.path; j.close();
  await expect(open(path).send({ ...request, state: { ...request.state, itemName: 'Another bowl' } })).rejects.toThrow('Invalid prior Jev response');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('concurrent requests cannot spend against the same reservation', async () => {
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body(request))), j = open();
  const outcomes = await Promise.allSettled([j.send(request), j.send(request)]);
  expect(outcomes.map(o => o.status)).toEqual(['fulfilled', 'rejected']); expect(fetcher).toHaveBeenCalledTimes(1);
});
test('torn journals and concurrent owners fail closed', () => {
  const j = open(); expect(() => open(j.path)).toThrow(); const path = j.path; j.close();
  appendFileSync(path, '{"event":"jev_request"'); expect(() => open(path)).toThrow('Incomplete POC journal');
});
test('PDF search is enqueued once per missing-data brand and survives resume', () => {
  const j = open(); j.enqueuePdf({ id: 'brand', displayName: 'Chain without nutrition' }); const path = j.path; j.close();
  const resumed = open(path); resumed.enqueuePdf({ id: 'brand', displayName: 'Chain without nutrition' });
  expect(resumed.events.filter(e => e.event === 'pdf_search_enqueued')).toHaveLength(1);
});
