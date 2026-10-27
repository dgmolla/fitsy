import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as health } from '../app/api/health/route';
import { POST as login } from '../app/api/auth/login/route';
import { POST as register } from '../app/api/auth/register/route';
import { prisma } from '../lib/restaurantService';
import { POST as webhook } from '../app/api/revenuecat/webhook/route';
import { subscriptionBypass } from '../lib/subscription';

// Real request handlers and Supabase SDK; only the external auth transport is
// substituted. No listener or database is available in the restricted worker.
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
let providerCalls = 0;
before(() => {
  process.env['VERCEL_ENV'] = 'production';
  process.env['SUPABASE_URL'] = 'https://fixture.supabase.test';
  process.env['SUPABASE_ANON_KEY'] = 'fixture-public-key';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'fixture-server-key';
  process.env['POSTGRES_PRISMA_URL'] = 'invalid-security-audit-sentinel';
  global.fetch = async () => {
    providerCalls++;
    return Response.json({ msg: 'Invalid login credentials' }, { status: 400 });
  };
});
after(async () => {
  global.fetch = originalFetch;
  process.env = originalEnv;
  await prisma.$disconnect();
});
const request = (path: string, email: string) => new NextRequest(`http://localhost/api/auth/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'fixture-password' }),
});

test('the public health response never exposes Prisma configuration errors', async () => {
  const response = await health();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'Service unavailable');
  assert.ok(!JSON.stringify(body).includes('Prisma'));
  assert.ok(!JSON.stringify(body).includes('POSTGRES_PRISMA_URL'));
});

test('production password login rejects non-review accounts before contacting Supabase', async () => {
  const beforeCalls = providerCalls;
  const response = await login(request('login', 'ordinary@example.test'));
  assert.equal(response.status, 403);
  assert.equal(providerCalls, beforeCalls);
});

test('production cannot self-confirm email ownership through legacy registration', async () => {
  const beforeCalls = providerCalls;
  const response = await register(request('register', 'appreview@fitsy.org'));
  assert.equal(response.status, 403);
  assert.equal(providerCalls, beforeCalls);
});

test('production entitlement cannot be enabled through dev bypass flags or extra demo emails', () => {
  process.env['ALLOW_STUB_SUBSCRIPTIONS'] = 'true';
  process.env['DEMO_REVIEW_EMAILS'] = 'appreview@fitsy.org,ordinary@example.test';
  assert.equal(subscriptionBypass('ordinary@example.test'), false);
  assert.equal(subscriptionBypass('appreview@fitsy.org'), true);
});

test('reviewer credentials still reach Supabase and an invalid password is rejected', async () => {
  const beforeCalls = providerCalls;
  const response = await login(request('login', ' APPREVIEW@FITSY.ORG '));
  assert.equal(response.status, 401);
  assert.equal(providerCalls, beforeCalls + 1);
});

test('sandbox purchases and unrelated entitlements never reach production persistence', async () => {
  process.env['REVENUECAT_WEBHOOK_AUTH'] = 'fixture-webhook-auth';
  for (const overrides of [{ environment: 'SANDBOX' }, { entitlement_ids: ['other-product'] }]) {
    const response = await webhook(new NextRequest('http://localhost/api/revenuecat/webhook', {
      method: 'POST', headers: { authorization: 'fixture-webhook-auth', 'content-type': 'application/json' },
      body: JSON.stringify({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'fixture-account',
        environment: 'PRODUCTION', entitlement_ids: ['pro'], ...overrides } }),
    }));
    assert.equal(response.status, 200); // Invalid DB target would fail if persistence were reached.
    assert.deepEqual(await response.json(), { received: true });
  }
});
