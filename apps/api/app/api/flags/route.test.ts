jest.mock('@/services/authService', () => ({ verifyToken: async () => ({ sub: 'flags-user', email: 'flags@example.test' }) }));
import { NextRequest } from 'next/server';
const request = () => new NextRequest('http://localhost/api/flags', { headers: { authorization: 'Bearer fixture' } });
import { flagsSchema } from '../../../../../packages/shared/src/contracts/flags';
import { GET } from './route';

const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv };
  for (const key of Object.keys(process.env)) if (key.startsWith('FLAG_')) delete process.env[key];
});
afterEach(() => { process.env = originalEnv; });

test('GET requires a session and returns private flags', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({});
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

test('publishes only explicitly public mobile booleans and reads current env', async () => {
  process.env.FLAG_PRIVATE = 'true';
  process.env.POSTGRES_PRISMA_URL = 'never-expose';
  process.env.FLAG_MOBILE_TEST = 'true';
  process.env.FLAG_MOBILE_OFF = 'false';
  process.env.FLAG_MOBILE_INVALID = 'yes';
  process.env.FLAG_MOBILE_bad = 'true';
  expect(flagsSchema.parse(await (await GET(request())).json())).toEqual({ TEST: true, OFF: false, INVALID: false });
  process.env.FLAG_MOBILE_TEST = 'false';
  expect(await (await GET(request())).json()).toMatchObject({ TEST: false });
});
