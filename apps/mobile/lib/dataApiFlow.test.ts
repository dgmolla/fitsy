import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve(__dirname, '../e2e/helpers/data-api.mjs'), 'utf8');
function execute(loginStatus = 200, token: string | undefined = 'private-access-token') {
  const output: Record<string, unknown> = { apiPaths: ['/api/restaurants?lat=34&lng=-118', '/api/restaurants/fixture/menu'] };
  const http = {
    post: jest.fn(() => ({ status: loginStatus, body: JSON.stringify({ token }) })),
    get: jest.fn((_url: string, config?: { headers: { Authorization: string } }) => ({
      status: config?.headers.Authorization === 'Bearer private-access-token' ? 200 : 401,
      body: JSON.stringify(config?.headers.Authorization === 'Bearer private-access-token' ? { data: [] } : { error: 'Unauthorized' }),
    })),
  };
  runInNewContext(source, { output, http, json: JSON.parse, LOGIN_EMAIL: 'fixture@example.test', LOGIN_PASSWORD: 'private-password' });
  return { output, http };
}

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

test('every maintained flow uses the authenticated helper for direct restaurant API requests', () => {
  const directory = resolve(__dirname, '../e2e/flows');
  for (const file of readdirSync(directory).filter(name => name.endsWith('.yaml'))) {
    expect(readFileSync(resolve(directory, file), 'utf8')).not.toMatch(/http\.get\([^\n]*\/api\/restaurants/);
  }
});
