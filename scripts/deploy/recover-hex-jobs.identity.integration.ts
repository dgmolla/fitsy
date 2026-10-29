import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { recoveryTarget } from './hex-jobs-recovery-target';

const request = 'https://run-1.services.actions.githubusercontent.com/token';
const issuer = 'https://token.actions.githubusercontent.com';
const source = 'a'.repeat(40);
const env = {
  GITHUB_ACTIONS: 'true', GITHUB_SHA: source, FITSY_ALLOW_PROD_WRITE: '1',
  ACTIONS_ID_TOKEN_REQUEST_URL: request, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-request-secret',
  POSTGRES_URL_NON_POOLING: 'postgresql://postgres.zaxkmjqozvmbifiwbxps:synthetic-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
};
const claims = {
  iss: issuer, aud: 'https://fitsy.org/hex-jobs-recovery',
  sub: 'repo:dgmolla/fitsy:environment:production-release', repository: 'dgmolla/fitsy',
  ref: 'refs/heads/main', workflow_ref: 'dgmolla/fitsy/.github/workflows/production-migration-recovery.yml@refs/heads/main',
  event_name: 'workflow_dispatch', runner_environment: 'github-hosted', sha: source, workflow_sha: source,
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>, issued = '', requests: string[] = [];
const original = global.fetch;
before(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'recovery-fixture', alg: 'RS256', use: 'sig' };
  global.fetch = async (url, init) => {
    const address = String(url); requests.push(address);
    if (address.startsWith(request + '?')) {
      assert.equal(new URL(address).searchParams.get('audience'), claims.aud);
      assert.equal((init!.headers as Record<string, string>)['Authorization'], 'Bearer synthetic-request-secret');
      assert.equal(init!.redirect, 'error');
      return Response.json({ value: issued });
    }
    assert.equal(address, issuer + '/.well-known/jwks');
    return Response.json({ keys: [jwk] });
  };
});
after(() => { global.fetch = original; });
async function token(overrides: Record<string, unknown> = {}, key = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iat: now, nbf: now, exp: now + 300, ...claims, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'recovery-fixture' }).sign(key);
}

test('only the signed protected recovery workflow can audit or resolve the production target', async () => {
  issued = await token();
  assert.equal(await recoveryTarget('audit', { ...env, FITSY_ALLOW_PROD_WRITE: '' }), env.POSTGRES_URL_NON_POOLING);
  assert.equal(await recoveryTarget('resolve', env), env.POSTGRES_URL_NON_POOLING);
  await assert.rejects(recoveryTarget('resolve', { ...env, FITSY_ALLOW_PROD_WRITE: '' }), /Recovery refused/);
});

test('other workflows, events, environments and stale or mismatched sources cannot authorize recovery', async () => {
  for (const overrides of [
    { repository: 'other/fitsy' }, { ref: 'refs/heads/feature' }, { event_name: 'push' },
    { workflow_ref: 'dgmolla/fitsy/.github/workflows/prod-fixture-cleanup.yml@refs/heads/main' },
    { sub: 'repo:dgmolla/fitsy:environment:production-native' }, { runner_environment: 'self-hosted' },
    { sha: 'b'.repeat(40), workflow_sha: 'b'.repeat(40) }, { workflow_sha: 'b'.repeat(40) },
    { iss: 'https://untrusted.invalid' }, { aud: 'https://fitsy.org/database-write' },
    { exp: 1 }, { exp: undefined }, { nbf: undefined }, { iat: undefined },
    { nbf: Math.floor(Date.now() / 1000) + 600 },
  ]) {
    issued = await token(overrides);
    await assert.rejects(recoveryTarget('resolve', env), /Recovery refused/);
  }
  const foreign = await generateKeyPair('RS256');
  issued = await token({}, foreign.privateKey);
  await assert.rejects(recoveryTarget('resolve', env), /Recovery refused/);
  issued = 'invalid-synthetic-token';
  await assert.rejects(recoveryTarget('resolve', env), /Recovery refused/);
});

test('target or request changes fail before transmitting credentials and cannot approve role SQL', async () => {
  for (const overrides of [
    { POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace(':5432/', ':6543/') },
    { POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace('zaxkmjqozvmbifiwbxps', 'kegycybiruksmrzvniha') },
    { POSTGRES_URL_NON_POOLING: 'postgresql://postgres:synthetic@localhost:5432/postgres' },
    { POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace('/postgres', '/other') },
    { POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace('postgres.zax', 'pipeline_writer.zax') },
    { POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING + '?options=reference%3Dkegycybiruksmrzvniha' },
    { POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING + '?schema=other' },
    { POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING + '?pgbouncer=true' },
    { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://untrusted.invalid/token' },
    { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.githubusercontent.com.untrusted.invalid/token' },
    { ACTIONS_ID_TOKEN_REQUEST_URL: request.replace('https:', 'http:') },
    { ACTIONS_ID_TOKEN_REQUEST_URL: request.replace('https://', 'https://user:synthetic@') },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }, { GITHUB_ACTIONS: '' },
    { FITSY_PIPELINE_ROLES_APPROVED_SHA256: 'a'.repeat(64) },
  ]) {
    requests = [];
    await assert.rejects(recoveryTarget('resolve', { ...env, ...overrides }), /Recovery refused/);
    assert.deepEqual(requests, []);
  }
});

test('provider failures stay private and cannot supply recovery authority', async () => {
  const transport = global.fetch;
  try {
    for (const result of ['throw', 'http', 'malformed']) {
      global.fetch = async () => {
        if (result === 'throw') throw new Error('synthetic-provider-secret');
        return result === 'http' ? new Response('synthetic-provider-secret', { status: 503 })
          : Response.json({ value: 123, diagnostic: 'synthetic-provider-secret' });
      };
      await assert.rejects(recoveryTarget('resolve', env), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Recovery refused/);
        assert.ok(!error.message.includes('synthetic'));
        return true;
      });
    }
  } finally { global.fetch = transport; }
});
