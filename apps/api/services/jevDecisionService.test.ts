import { parseJevDecision, requestJevDecision } from './jevDecisionService';
const request = { model: 'jev-latest' as const, state: { menuItem: { name: 'Synthetic test item' } },
  questions: { chain_item_match: { type: 'choice' as const, instructions: 'Synthetic unit test only', criteria: { match: 'Same item', no_match: 'Different item' } } } };

const good = () => ({ model: 'jev-1.14.0', answers: { chain_item_match: { type: 'choice', choice: 'match', confidence: 0.99,
  probabilities: { match: 0.99, no_match: 0.01 } } }, usage: { input_tokens: 700, output_tokens: 10 } });
afterEach(() => jest.restoreAllMocks());

test('provider preserves the raw response, uses the official endpoint and never retries HTTP errors', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
  expect(await requestJevDecision(request, 'unit-test-only')).toEqual({ status: 429, body: 'rate limited' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', expect.objectContaining({
    method: 'POST', redirect: 'error', body: JSON.stringify(request), signal: expect.any(AbortSignal),
    headers: { Authorization: 'Bearer unit-test-only', 'Content-Type': 'application/json' },
  }));
});

test('missing credentials and oversized requests fail before network access', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  await expect(requestJevDecision(request, ' ')).rejects.toThrow('TYPESAFE_API_KEY');
  await expect(requestJevDecision({ ...request, state: { payload: 'a'.repeat(12_001) } }, 'test')).rejects.toThrow('12KB');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('transport errors propagate once without exposing credentials or retrying', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unreachable'));
  await expect(requestJevDecision(request, 'test')).rejects.toThrow('unreachable');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('valid responses retain the resolved model and billable usage', () => {
  expect(parseJevDecision(JSON.stringify(good()))).toEqual(good());
});

test.each([
  (r: ReturnType<typeof good>) => { r.answers.chain_item_match.probabilities.match = 2; },
  (r: ReturnType<typeof good>) => { r.answers.chain_item_match.confidence = -1; },
  (r: ReturnType<typeof good>) => { r.answers.chain_item_match.choice = 'unknown'; },
  (r: ReturnType<typeof good>) => { r.answers.chain_item_match.type = 'score'; },
  (r: ReturnType<typeof good>) => { r.answers.chain_item_match.probabilities.no_match = 0.4; },
  (r: ReturnType<typeof good>) => { r.answers.chain_item_match.probabilities = { match: 0.01, no_match: 0.99 }; },
  (r: ReturnType<typeof good>) => { r.usage.input_tokens = -1; },
  (r: ReturnType<typeof good>) => { r.usage.input_tokens = 0.5; },
  (r: ReturnType<typeof good>) => { r.model = 'not-jev'; },
])('malformed decisions fail validation (%#)', mutate => {
  const value = good(); mutate(value);
  expect(() => parseJevDecision(JSON.stringify(value))).toThrow();
});

test.each(['not JSON', '{}', '{"model":"jev-latest","answers":{}}'])('missing answers or usage never become a free negative: %s', body => {
  expect(() => parseJevDecision(body)).toThrow();
});
