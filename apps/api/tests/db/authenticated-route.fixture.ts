import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from '../../lib/restaurantService';
import { quotaService } from '../fixtures/quotaService';

// Native ESM runner supports jose. Real handlers, JWT verification and Postgres.
const keys = createServer();
export const userId = randomUUID();
export let token: string;
export let freeToken: string;
const freeId = randomUUID();
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
before(async () => {
  const quota = quotaService();
  // Simulate the explicitly trusted deployment boundary and external Redis only.
  process.env['VERCEL'] = '1';
  process.env['VERCEL_ENV'] = 'preview';
  process.env['UPSTASH_REDIS_REST_URL'] = 'https://quota.example.test';
  process.env['UPSTASH_REDIS_REST_TOKEN'] = 'fixture-token';
  global.fetch = async (input, init) => String(input) === 'https://quota.example.test/'
    ? Response.json({ result: quota.command(JSON.parse(String(init?.body))) }) : originalFetch(input, init);
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
  delete process.env['REVENUECAT_PUBLIC_API_KEY'];
  const email = `${userId}@example.test`;
  await prisma.user.create({ data: { id: userId, email,
    subscription: { create: { plan: 'monthly', status: 'active', lastEventAt: new Date() } } } });
  token = await new SignJWT({ email, role: 'authenticated', is_anonymous: false }).setIssuedAt().setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
    .setSubject(userId).setIssuer(`${process.env['SUPABASE_URL']}/auth/v1`)
    .setAudience('authenticated').setExpirationTime('5m').sign(privateKey);
  const freeEmail = `${freeId}@example.test`;
  await prisma.user.create({ data: { id: freeId, email: freeEmail } });
  freeToken = await new SignJWT({ email: freeEmail, role: 'authenticated', is_anonymous: false }).setIssuedAt()
    .setProtectedHeader({ alg: 'ES256', kid: 'fixture' }).setSubject(freeId)
    .setIssuer(`${process.env['SUPABASE_URL']}/auth/v1`).setAudience('authenticated').setExpirationTime('5m').sign(privateKey);
});
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, freeId] } } });
  await new Promise<void>((resolve, reject) => keys.close(err => err ? reject(err) : resolve()));
  global.fetch = originalFetch;
  process.env = originalEnv;
});
export const request = (query: string, authenticated: boolean | 'free' = true) => new NextRequest(
  `http://localhost/api/restaurants?lat=34.05&lng=-118.25&${query}`,
  authenticated ? { headers: { authorization: `Bearer ${authenticated === 'free' ? freeToken : token}` } } : {},
);
