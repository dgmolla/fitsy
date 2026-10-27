import { inspect } from 'node:util';
import { NextRequest } from 'next/server';
import { useRateLimitTransport } from '@/tests/fixtures/rateLimitTransport';

// Keep the handlers, Supabase SDK and rate limiter real. Only persistence and
// external HTTP are replaced, so provider/SDK logging is part of the assertion.
jest.mock('@/lib/restaurantService', () => {
  const user = { findUnique: jest.fn(), upsert: jest.fn(), create: jest.fn(), update: jest.fn() };
  return { prisma: { user, $transaction: (fn: (tx: { user: typeof user }) => unknown) => fn({ user }) } };
});

import { POST as apple } from './apple/route';
import { POST as google } from './google/route';
import { POST as login } from './login/route';
import { POST as register } from './register/route';
import { prisma } from '@/lib/restaurantService';

const SENTINEL = 'PRIVATE_SENTINEL_575';
const credentials = { email: 'person@example.test', password: 'password123' };
const appleBody = { identityToken: 'apple-token', nonce: 'raw-nonce' };
const routes = { apple, google, login, register };
const validBodies = { apple: appleBody, google: { idToken: 'google-token' }, login: credentials, register: credentials };
const transport = useRateLimitTransport();
let logs: jest.SpyInstance[];

beforeEach(() => {
  jest.clearAllMocks();
  process.env['VERCEL_ENV'] = 'preview';
  process.env['SUPABASE_URL'] = 'https://auth.example.test';
  process.env['SUPABASE_ANON_KEY'] = 'fixture-anon-key';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'fixture-admin-key';
  logs = ['error', 'warn', 'info', 'log'].map(level =>
    jest.spyOn(console, level as 'error').mockImplementation(() => {}));
  transport.mockImplementation(async url => String(url).includes('quota.example.test')
    ? Response.json({ result: [1, 0, 0] })
    : Response.json({ message: SENTINEL, code: SENTINEL }, { status: 400 }));
});

afterEach(() => {
  const captured = inspect(logs.map(log => log.mock.calls), { depth: 10 });
  logs.forEach(log => log.mockRestore());
  expect(captured).not.toContain(SENTINEL);
});

function request(route: string, body: unknown) {
  return new NextRequest(`http://localhost/api/auth/${route}`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

const malformed: [keyof typeof routes, unknown][] = [
  ...Object.keys(routes).flatMap(route => [null, [], 'string'].map(body => [route as keyof typeof routes, body] as [keyof typeof routes, unknown])),
  ['apple', { ...appleBody, fullName: { givenName: { secret: SENTINEL } } }],
  ['apple', { ...appleBody, fullName: [] }],
  ['apple', { ...appleBody, fullName: { familyName: SENTINEL.repeat(30) } }],
  ['apple', { ...appleBody, identityToken: SENTINEL.repeat(1200) }],
  ['apple', { ...appleBody, nonce: SENTINEL.repeat(100) }],
  ['apple', { ...appleBody, authorizationCode: SENTINEL.repeat(1200) }],
  ['google', { idToken: SENTINEL.repeat(1200) }],
  ['login', { ...credentials, password: SENTINEL.repeat(100) }],
  ['login', { ...credentials, email: `${SENTINEL.repeat(30)}@example.test` }],
  ['register', { ...credentials, name: { secret: SENTINEL } }],
  ['register', { ...credentials, name: SENTINEL.repeat(30) }],
  ['register', { ...credentials, password: SENTINEL.repeat(100) }],
];

it.each(malformed)('%s rejects malformed or oversized input before provider work (%#)', async (route, body) => {
  const response = await routes[route](request(route, body));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: expect.any(String) });
  expect(transport.mock.calls.every(([url]) => String(url).includes('quota.example.test'))).toBe(true);
  expect(prisma.user.upsert).not.toHaveBeenCalled();
  expect(prisma.user.create).not.toHaveBeenCalled();
});

it.each(Object.keys(routes) as (keyof typeof routes)[])('%s returns safe JSON on provider rejection', async route => {
  const response = await routes[route](request(route, validBodies[route]));
  expect(response.status).toBe(route === 'register' ? 500 : 401);
  expect(await response.json()).toEqual({ error: expect.not.stringContaining(SENTINEL) });
});

it.each(Object.keys(routes) as (keyof typeof routes)[])('%s contains transport failures, including SDK logging', async route => {
  transport.mockImplementation(async url => {
    if (String(url).includes('quota.example.test')) return Response.json({ result: [1, 0, 0] });
    throw new Error(`${SENTINEL} credential provider request`);
  });
  const response = await routes[route](request(route, validBodies[route]));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Authentication provider unavailable' });
});

it.each(['apple', 'google'] as const)('%s preserves native authentication and rejects sensitive DB failures safely', async route => {
  const user = { id: 'provider-user', email: 'person@example.test', user_metadata: { name: 'Native User' } };
  transport.mockImplementation(async url => String(url).includes('quota.example.test')
    ? Response.json({ result: [1, 0, 0] })
    : Response.json({ access_token: 'provider-token', refresh_token: 'provider-refresh', expires_in: 3600, token_type: 'bearer', user }));
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.user.upsert as jest.Mock).mockImplementation(async ({ create }) => create);
  const body = route === 'apple' ? { ...appleBody, authorizationCode: 'apple-code', email: null,
    fullName: { givenName: 'Zoë', familyName: null } } : validBodies.google;
  const response = await routes[route](request(route, body));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ token: 'provider-token', refreshToken: 'provider-refresh',
    isNewUser: true, user: { name: route === 'apple' ? 'Zoë' : 'Native User' } });
  const providerCall = transport.mock.calls.find(([url]) => String(url).includes('/auth/v1/token'))!;
  expect(JSON.parse(String(providerCall[1]?.body))).toMatchObject({
    provider: route, id_token: route === 'apple' ? 'apple-token' : 'google-token',
    ...(route === 'apple' ? { nonce: 'raw-nonce' } : {}),
  });
  (prisma.user.upsert as jest.Mock).mockRejectedValue(new Error(`${SENTINEL} DB query and credentials`));
  const failed = await routes[route](request(route, body));
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: 'Internal server error' });
});

it.each(Object.keys(routes) as (keyof typeof routes)[])('%s bounds ignored fields by actual bytes without trusting Content-Length', async route => {
  const oversized = { ...validBodies[route], ignored: 'é'.repeat(40 * 1024) };
  const req = request(route, oversized);
  req.headers.set('content-length', '1');
  const response = await routes[route](req);
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: 'Request body too large' });
  expect(transport.mock.calls.every(([url]) => String(url).includes('quota.example.test'))).toBe(true);
});
