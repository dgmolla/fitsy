import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../lib/auth';

// Only the external JWKS transport is substituted. Token signatures, claims,
// NextRequest, requireAuth and shared rate limits execute as application code.
const issuer = 'https://fixture.supabase.test/auth/v1';
const originalFetch = global.fetch;
const originalUrl = process.env['SUPABASE_URL'];
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
before(async () => {
  process.env['SUPABASE_URL'] = 'https://fixture.supabase.test';
  keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'session-fixture', alg: 'ES256', use: 'sig' };
  global.fetch = async input => {
    assert.equal(String(input), `${issuer}/.well-known/jwks.json`);
    return Response.json({ keys: [jwk] });
  };
});
after(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env['SUPABASE_URL'];
  else process.env['SUPABASE_URL'] = originalUrl;
});
async function token(overrides: Record<string, unknown> = {}, signingKey = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: 'fixture-account', email: 'account@example.test', role: 'authenticated',
    iss: issuer, aud: 'authenticated', iat: now, exp: now + 300, ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: 'session-fixture' }).sign(signingKey);
}
const request = (bearer: string) => new NextRequest('http://localhost/api/restaurants', {
  headers: { authorization: `Bearer ${bearer}` },
});

test('a correctly signed Supabase account token reaches the authenticated caller', async () => {
  const result = await requireAuth(request(await token()));
  assert.deepEqual(result, { sub: 'fixture-account', email: 'account@example.test' });
});

test('invalid, expired, foreign-project and non-account tokens return 401', async () => {
  for (const claims of [
    { exp: 1 }, { exp: undefined }, { sub: undefined }, { sub: '' }, { email: undefined },
    { aud: 'anon' }, { iss: 'https://other-project.supabase.test/auth/v1' },
    { role: 'service_role' }, { is_anonymous: true },
  ]) {
    const result = await requireAuth(request(await token(claims)));
    assert.ok(result instanceof NextResponse);
    assert.equal(result.status, 401, JSON.stringify(claims));
    assert.deepEqual(await result.json(), { error: 'Unauthorized' });
  }
  const otherKeys = await generateKeyPair('ES256');
  assert.equal((await requireAuth(request(await token({}, otherKeys.privateKey))) as NextResponse).status, 401);
});

test('production also rejects non-review password sessions obtained directly from Supabase', async () => {
  const original = process.env['VERCEL_ENV'];
  process.env['VERCEL_ENV'] = 'production';
  try {
    const passwordSession = { app_metadata: { provider: 'email', providers: ['email', 'google'] },
      amr: [{ method: 'password' }], user_metadata: { provider: 'google', email_verified: true } };
    const denied = await requireAuth(request(await token(passwordSession)));
    assert.ok(denied instanceof NextResponse);
    assert.equal(denied.status, 401);
    for (const provider of ['apple', 'google']) {
      const accepted = await requireAuth(request(await token({
        app_metadata: { provider, providers: [provider] }, amr: [{ method: 'oauth' }],
      })));
      assert.deepEqual(accepted, { sub: 'fixture-account', email: 'account@example.test' });
    }
    const reviewer = await requireAuth(request(await token({ ...passwordSession, email: 'appreview@fitsy.org' })));
    assert.deepEqual(reviewer, { sub: 'fixture-account', email: 'appreview@fitsy.org' });
  } finally {
    if (original === undefined) delete process.env['VERCEL_ENV'];
    else process.env['VERCEL_ENV'] = original;
  }
});
