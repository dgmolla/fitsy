import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const helper = '../helpers/shuffle-subscriber.mjs';
const source = readFileSync(resolve(__dirname, '../e2e/helpers/shuffle-subscriber.mjs'), 'utf8');
const verified = { active: true, verdict: 'active', stale: false, lastRcVerifiedAt: '2026-10-26T00:00:00Z', status: 'active' };
const pick = { meta: { locked: false }, data: [{ bestMatch: { menuItemId: 'dish', calories: 280 } }] };
const reply = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });

function execute({ login = reply({ token: 'private-token' }), shuffle = reply(pick), proof = reply(verified) } = {}) {
  const output: Record<string, unknown> = {};
  const http = {
    post: jest.fn(() => login),
    get: jest.fn((url: string) => url.includes('/api/restaurants?') ? shuffle : proof),
  };
  runInNewContext(source, { http, output, json: JSON.parse, LOGIN_EMAIL: 'subscriber@example.test', LOGIN_PASSWORD: 'private-password' });
  return { output, http };
}

it('checks authenticated search before mobile launch without an explicit subscription sync or exposed credentials', () => {
  const { loadAll } = require('js-yaml') as { loadAll(text: string): unknown[] };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/shuffle.yaml'), 'utf8')) as [unknown, Record<string, unknown>[]];
  const helperIndex = commands.findIndex(command => command.runScript === helper);
  expect(helperIndex).toBeGreaterThan(-1);
  expect(helperIndex).toBeLessThan(commands.findIndex(command => command.launchApp));
  const { output, http } = execute();
  expect(http.post).toHaveBeenCalledWith('https://dev.fitsy.org/api/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'subscriber@example.test', password: 'private-password' }),
  });
  expect(http.get.mock.calls.map(([url]) => url)).toEqual([
    'https://dev.fitsy.org/api/restaurants?lat=34.0407&lng=-118.2468&calories=280&protein=28&carbs=34&fat=5',
    'https://dev.fitsy.org/api/subscriptions/status',
  ]);
  expect(http.get).toHaveBeenCalledWith(expect.any(String), { headers: { Authorization: 'Bearer private-token' } });
  expect(output).toEqual({ shuffleApiLoginStatus: 200, shuffleApiStatus: 200, shuffleApiUnlocked: true,
    shuffleApiHasDish: true, shuffleApiHasMacros: true, shuffleApiVerified: true });
  const assertions = commands.slice(helperIndex + 1, helperIndex + 3).map(command => command.assertTrue);
  for (const assertion of assertions) {
    expect(typeof assertion).toBe('string');
    expect(runInNewContext((assertion as string).slice(2, -1), { output })).toBe(true);
  }
  expect(JSON.stringify(output)).not.toMatch(/private-token|private-password|subscriber@example/);
});

it.each([
  { ...verified, status: null, lastRcVerifiedAt: null }, // Demo bypass without a subscription row.
  { ...verified, active: false },
  { ...verified, verdict: 'unknown', stale: true },
  { ...verified, status: 'expired' },
])('rejects incomplete or inactive server proof: %j', proof => {
  expect(execute({ proof: reply(proof) }).output.shuffleApiVerified).toBe(false);
});

it.each([reply({}, 401), reply({})])('does not send a search request without a successful login and token', login => {
  const { http, output } = execute({ login });
  expect(http.get).not.toHaveBeenCalled();
  expect(output.shuffleApiUnlocked).toBe(false);
});

it.each([reply({}, 503), reply({ meta: { locked: true }, data: [] })])(
  'rejects an unavailable endpoint or locked teaser', shuffle => {
    const { output } = execute({ shuffle });
    expect(output.shuffleApiUnlocked).toBe(false);
    expect(output.shuffleApiHasDish).toBe(false);
    expect(output.shuffleApiHasMacros).toBe(false);
  },
);
