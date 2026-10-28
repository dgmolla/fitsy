import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve(__dirname, '../e2e/helpers/data-api.mjs'), 'utf8');
function execute(loginStatus = 200, token: string | undefined = 'private-access-token', unauthStatus = 401, invalidStatus = unauthStatus) {
  const output: Record<string, unknown> = { apiPaths: ['/api/restaurants?lat=34&lng=-118', '/api/restaurants/fixture/menu'] };
  const http = {
    post: jest.fn(() => ({ status: loginStatus, body: JSON.stringify({ token }) })),
    get: jest.fn((_url: string, config?: { headers: { Authorization: string } }) => ({
      status: config?.headers.Authorization === 'Bearer private-access-token' ? 200 : config ? invalidStatus : unauthStatus,
      body: JSON.stringify(config?.headers.Authorization === 'Bearer private-access-token' ? { data: [] } : { error: 'Unauthorized' }),
    })),
  };
  const log = jest.fn();
  runInNewContext(source, { output, http, console: { log }, json: JSON.parse, LOGIN_EMAIL: 'fixture@example.test', LOGIN_PASSWORD: 'private-password' });
  return { output, http, log };
}

test.each([
  [401, 503, 200, 0], // The shared store can fail before invalid-session verification or login.
  [401, 401, 503, 503],
  [401, 401, 401, 401],
  [200, 200, 200, 0],
  [401, 401, 200, 200],
])('retains safe numeric diagnostics for preflight HTTP %s/%s and login %s', (missing, invalid, login, expectedLogin) => {
  const { log } = execute(login, 'private-access-token', missing, invalid);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith('[data-api] ' + JSON.stringify({
    unauthStatus: missing, invalidStatus: invalid, loginStatus: expectedLogin,
  }));
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-access-token|private-password|fixture@example|Unauthorized/);
});

test('the saved helper captures anonymous 401s and authenticated JSON without persisting credentials', () => {
  const { http, output } = execute();
  expect(output.dataApiUnauthStatus).toBe(401);
  expect(output.dataApiInvalidStatus).toBe(401);
  expect(output.dataApiResponses).toEqual(Array.from({ length: 2 }, () => ({ status: 200, body: '{"data":[]}' })));
  expect(http.get).toHaveBeenLastCalledWith('https://dev.fitsy.org/api/restaurants/fixture/menu', { headers: { Authorization: 'Bearer private-access-token' } });
  expect(JSON.stringify(output)).not.toMatch(/private-access-token|private-password|fixture@example/);
});

test.each([[401, 'token'], [200, '']])('failed login (%s) cannot send an authenticated data probe', (status, token) => {
  const { http, output } = execute(status as number, token as string | undefined);
  expect(http.get).toHaveBeenCalledTimes(2); // Only explicit no-session/invalid-session controls.
  expect(output.dataApiResponses).toEqual([]);
});

test.each([[200, 200], [200, 401], [401, 200], [503, 503]])(
  'a stale dev backend (%s/%s) preserves status diagnostics without login or a script exception', (missing, invalid) => {
    const { http, output } = execute(200, 'private-access-token', missing, invalid);
    expect(output.dataApiUnauthStatus).toBe(missing);
    expect(output.dataApiInvalidStatus).toBe(invalid);
    expect(output.dataApiLoginStatus).toBe(0);
    expect(output.dataApiResponses).toEqual([]);
    expect(http.post).not.toHaveBeenCalled();
    expect(http.get).toHaveBeenCalledTimes(2);
  },
);

test('every helper caller fails with deployment diagnostics before using a failed preflight result', () => {
  const { loadAll } = require('js-yaml') as { loadAll(text: string): unknown[] };
  const directory = resolve(__dirname, '../e2e/flows');
  let callers = 0;
  for (const file of readdirSync(directory).filter(name => name.endsWith('.yaml'))) {
    const [, commands] = loadAll(readFileSync(resolve(directory, file), 'utf8')) as [unknown, Record<string, unknown>[]];
    commands.forEach((command, index) => {
      if (command.runScript !== '../helpers/data-api.mjs') return;
      callers++;
      const assertion = commands[index + 1]?.assertTrue as { condition: string; label: string; optional?: boolean };
      expect(assertion.optional).not.toBe(true);
      expect(assertion.label).toMatch(/candidate.*dev\.fitsy\.org/i);
      for (const key of ['dataApiUnauthStatus', 'dataApiInvalidStatus', 'dataApiLoginStatus']) expect(assertion.label).toContain(key);
      const condition = assertion.condition.slice(2, -1);
      const accepted = execute().output;
      expect(runInNewContext(condition, { output: accepted })).toBe(true);
      for (const key of ['dataApiUnauthStatus', 'dataApiInvalidStatus']) {
        for (const status of [200, 503]) {
          expect(runInNewContext(condition, { output: { ...accepted, [key]: status } })).toBe(false);
        }
      }
      for (const status of [0, 401]) {
        expect(runInNewContext(condition, { output: { ...accepted, dataApiLoginStatus: status } })).toBe(false);
      }
    });
  }
  expect(callers).toBe(12);
});

test('every maintained flow uses the authenticated helper for direct restaurant API requests', () => {
  const directory = resolve(__dirname, '../e2e/flows');
  for (const file of readdirSync(directory).filter(name => name.endsWith('.yaml'))) {
    expect(readFileSync(resolve(directory, file), 'utf8')).not.toMatch(/http\.get\([^\n]*\/api\/restaurants/);
  }
});
