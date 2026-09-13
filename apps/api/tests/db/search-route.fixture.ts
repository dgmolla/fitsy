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
export const restaurantIds = Array.from({ length: 4 }, () => randomUUID());
export const targets = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };
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
  for (const id of restaurantIds) {
    await prisma.restaurant.create({ data: { id, storeUuid: id, name: 'Menu regression',
      address: 'Local fixture', lat: 12, lng: 12, source: 'test', cuisineTags: [],
      menuItems: { create: Array.from({ length: 251 }, (_, i) => ({
        id: `${id}-${String(i + 1).padStart(3, '0')}`,
        name: i === 250 ? 'Zucchini chicken' : `A dish ${i + 1}`,
        ...(i === 250 ? targets : { calories: 900, proteinG: 10, carbsG: 100, fatG: 50 }),
        macroEstimates: { create: { ...targets, source: 'haiku', confidence: 'MEDIUM' } },
      })) } } });
    await prisma.macroEstimate.create({ data: { menuItemId: `${id}-251`, ...targets,
      source: 'merchant', confidence: 'HIGH', estimatedAt: new Date('2026-01-01') } });
  }
  token = await new SignJWT({ email }).setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
    .setSubject(userId).setIssuer(`${process.env['SUPABASE_URL']}/auth/v1`)
    .setAudience('authenticated').setExpirationTime('5m').sign(privateKey);
});
after(async () => {
  await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => keys.close(err => err ? reject(err) : resolve()));
});
export const request = (query: string, authenticated = true) => new NextRequest(
  `http://localhost/api/restaurants?lat=34.05&lng=-118.25&${query}`,
  authenticated ? { headers: { authorization: `Bearer ${token}` } } : {},
);

