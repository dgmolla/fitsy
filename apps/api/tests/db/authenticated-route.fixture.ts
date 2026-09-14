import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/restaurantService';

// Native ESM runner supports jose. Real handlers, JWT verification and Postgres.
const keys = createServer();
export const userId = randomUUID();
export let token: string;
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
  await new Promise<void>((resolve, reject) => keys.close(err => err ? reject(err) : resolve()));
});
export const request = (query: string, authenticated = true) => new NextRequest(
  `http://localhost/api/restaurants?lat=34.05&lng=-118.25&${query}`,
  authenticated ? { headers: { authorization: `Bearer ${token}` } } : {},
);

