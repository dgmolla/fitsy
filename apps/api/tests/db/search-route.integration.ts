import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { restaurantsResponseSchema } from '@fitsy/shared';
import { GET } from '../../app/api/restaurants/route';
import { GET as preview } from '../../app/api/restaurants/preview/route';
import { prisma } from '../../lib/restaurantService';

// Native ESM runner supports jose. Real handlers, JWT verification and Postgres.
const keys = createServer();
const userId = randomUUID();
let token: string;
before(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'ES256', use: 'sig' };
  keys.on('request', (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>(resolve => keys.listen(0, 'localhost', resolve));
  const address = keys.address();
  assert.ok(address && typeof address !== 'string');
  process.env['SUPABASE_URL'] = `http://localhost:${address.port}`;
  delete process.env['ALLOW_STUB_SUBSCRIPTIONS'];
  delete process.env['DEMO_REVIEW_EMAILS'];
  const email = `${userId}@example.test`;
  await prisma.user.create({ data: { id: userId, email,
    subscription: { create: { plan: 'monthly', status: 'active' } } } });
  token = await new SignJWT({ email }).setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
    .setSubject(userId).setIssuer(`${process.env['SUPABASE_URL']}/auth/v1`)
    .setAudience('authenticated').setExpirationTime('5m').sign(privateKey);
});
after(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => keys.close(err => err ? reject(err) : resolve()));
});
const request = (query: string, authenticated = true) => new NextRequest(
  `http://localhost/api/restaurants?lat=34.05&lng=-118.25&${query}`,
  authenticated ? { headers: { authorization: `Bearer ${token}` } } : {},
);

test('real authenticated search accepts equivalent aliases and keeps a valid wire contract', async () => {
  const short = await GET(request('calories=600&protein=40&carbs=60&fat=20'));
  const grams = await GET(request('calories=600&proteinG=40&carbsG=60&fatG=20'));
  assert.equal(short.status, 200);
  assert.equal(grams.status, 200);
  const a = await short.json(), b = await grams.json();
  assert.ok(a.data.length > 0, 'seed restaurants must exist');
  assert.equal(a.meta.locked, false);
  assert.ok(a.data[0].bestMatch);
  assert.deepEqual(a, b);
  assert.equal(restaurantsResponseSchema.safeParse(a).success, true);
});

test('invalid targets return 400 through the handler', async () => {
  for (const q of ['protein=NaN', 'fatG=-1', 'calories=', 'protein=40&proteinG=50']) {
    assert.equal((await GET(request(q))).status, 400, q);
  }
});

test('unauthenticated search still strips every best match', async () => {
  const response = await GET(request('proteinG=40', false));
  assert.equal(response.status, 200);
  const { data, meta } = await response.json();
  assert.ok(data.length > 0);
  assert.equal(meta.locked, true);
  assert.ok(data.every((row: { bestMatch?: unknown }) => !row.bestMatch));
});

test('onboarding preview uses the same aliases and rejects invalid targets without exposing matches', async () => {
  const a = await preview(request('calories=600&protein=40&carbs=60&fat=20', false));
  const b = await preview(request('calories=600&proteinG=40&carbsG=60&fatG=20', false));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const data = await a.json();
  assert.ok(data.data.length > 0);
  assert.deepEqual(data, await b.json());
  assert.ok(data.data.every((row: object) => !('bestMatch' in row)));
  for (const query of ['protein=NaN', 'proteinG=-1', 'calories=', 'protein=40&proteinG=50']) {
    assert.equal((await preview(request(query, false))).status, 400, query);
  }
});
