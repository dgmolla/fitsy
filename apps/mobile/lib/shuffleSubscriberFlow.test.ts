import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const helper = '../helpers/shuffle-subscriber.mjs';
const source = readFileSync(resolve(__dirname, '../e2e/helpers/shuffle-subscriber.mjs'), 'utf8');
const verified = { active: true, verdict: 'active', stale: false, lastRcVerifiedAt: '2026-10-26T00:00:00Z', status: 'active' };
const pick = { meta: { locked: false }, data: [{ id: 'restaurant', bestMatch: { menuItemId: 'dish', calories: 280 } }] };
const reply = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
const deployedSha = 'a'.repeat(40);

function execute({ login = reply({ token: 'private-token' }), validation = reply({ error: 'Invalid shuffle flag' }, 400),
  search = reply(pick), shuffle = reply({ ...pick, data: [{ ...pick.data[0], id: 'fresh-restaurant' }] }), proof = reply(verified) } = {}) {
  const output: Record<string, unknown> = {};
  const http = {
    post: jest.fn(() => login),
    get: jest.fn((url: string) => url.endsWith('/api/health') ? reply({ deploymentSha: deployedSha })
      : url.includes('shuffle=invalid') ? validation : url.includes('/api/restaurants?') ? url.includes('shuffle=1') ? shuffle : search : proof),
  };
  runInNewContext(source, { http, output, json: JSON.parse, LOGIN_EMAIL: 'subscriber@example.test', LOGIN_PASSWORD: 'private-password' });
  return { output, http };
}

it('checks authenticated search and fresh shuffle before mobile launch without an explicit subscription sync or exposed credentials', () => {
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
    'https://dev.fitsy.org/api/health',
    'https://dev.fitsy.org/api/restaurants?lat=34.0407&lng=-118.2468&calories=600&protein=40&carbs=60&fat=20&shuffle=invalid',
    'https://dev.fitsy.org/api/restaurants?lat=34.0407&lng=-118.2468&calories=600&protein=40&carbs=60&fat=20',
    'https://dev.fitsy.org/api/restaurants?lat=34.0407&lng=-118.2468&calories=600&protein=40&carbs=60&fat=20&shuffle=1&seed=maestro-before-mobile&excludeRestaurantIds=restaurant',
    'https://dev.fitsy.org/api/subscriptions/status',
  ]);
  expect(http.get).toHaveBeenCalledWith(expect.any(String), { headers: { Authorization: 'Bearer private-token' } });
  expect(output).toEqual({ shuffleApiLoginStatus: 200, shuffleSearchStatus: 200, shuffleApiStatus: 200, shuffleApiUnlocked: true,
    shuffleApiHasDish: true, shuffleApiHasMacros: true, shuffleApiVerified: true, shuffleApiListChanged: true,
    shuffleApiValidationStatus: 400, shuffleApiDeploymentSha: deployedSha, shuffleSearchCount: 1, shuffleResultCount: 1, shuffleTotal: 0 });
  const assertions = commands.slice(helperIndex + 1, helperIndex + 4).map(command => command.assertTrue as { condition: string; label: string });
  for (const assertion of assertions) {
    expect(assertion.label).toBeTruthy();
    expect(runInNewContext(assertion.condition.slice(2, -1), { output })).toBe(true);
  }
  expect(JSON.stringify(output)).not.toMatch(/private-token|private-password|subscriber@example/);
});

it.each([200, 503])('rejects an incompatible or unavailable backend (HTTP %s) with deployment diagnostics', status => {
  const { loadAll } = require('js-yaml') as { loadAll(text: string): unknown[] };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/shuffle.yaml'), 'utf8')) as [unknown, Record<string, unknown>[]];
  const { output, http } = execute({ validation: reply(pick, status) });
  expect(output.shuffleApiValidationStatus).toBe(status);
  expect(output.shuffleApiDeploymentSha).toBe(deployedSha);
  expect(output.shuffleApiListChanged).toBe(false);
  expect(http.get).toHaveBeenCalledTimes(2); // Health plus the authenticated capability probe, never selection or sync.
  const helperIndex = commands.findIndex(command => command.runScript === helper);
  const assertion = commands[helperIndex + 1].assertTrue as { condition: string; label: string; optional?: boolean };
  expect(assertion.optional).not.toBe(true);
  expect(assertion.label).toMatch(/dev\.fitsy\.org.*shuffleApiDeploymentSha.*candidate API/);
  expect(runInNewContext(assertion.condition.slice(2, -1), { output })).toBe(false);
  for (const key of ['shuffleApiUnlocked', 'shuffleApiHasDish', 'shuffleApiHasMacros', 'shuffleApiVerified', 'shuffleApiListChanged']) {
    expect((commands[helperIndex + 3].assertTrue as { label: string }).label).toContain(key);
  }
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

it('rejects a response that only reorders the same restaurant set', () => {
  expect(execute({ shuffle: reply(pick) }).output.shuffleApiListChanged).toBe(false);
});
