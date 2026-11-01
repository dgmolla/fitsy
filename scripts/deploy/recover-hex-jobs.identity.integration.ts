import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { recoveryTarget, RecoveryRefused } from './hex-jobs-recovery-target';

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

const privateMarker = 'sensitive-marker-keep-private';
async function refused(mode: 'audit' | 'resolve', overrides: NodeJS.ProcessEnv, reason: RegExp) {
  await assert.rejects(recoveryTarget(mode, { ...env, ...overrides }), error => {
    assert.ok(error instanceof RecoveryRefused);
    assert.match(error.message, reason);
    assert.match(error.message, /expected .*; got /);
    const output = inspect(error) + String(error.stack);
    for (const secret of ['synthetic-request-secret', 'synthetic-password', 'synthetic-provider-secret',
      privateMarker, env.POSTGRES_URL_NON_POOLING, issued].filter(Boolean)) {
      assert.ok(!output.includes(secret), 'refusal must withhold credential, token and provider values');
    }
    assert.doesNotMatch(output, /postgres(?:ql)?:\/\/|Bearer /);
    return true;
  });
}

test('only the signed protected recovery workflow can audit or resolve the production target', async () => {
  issued = await token();
  assert.equal(await recoveryTarget('audit', { ...env, FITSY_ALLOW_PROD_WRITE: '' }), env.POSTGRES_URL_NON_POOLING);
  assert.equal(await recoveryTarget('resolve', env), env.POSTGRES_URL_NON_POOLING);
  for (const url of [
    env.POSTGRES_URL_NON_POOLING.replace(':5432/', '/'),
    env.POSTGRES_URL_NON_POOLING + '?schema=public&pgbouncer=false',
    'postgresql://postgres:synthetic-password@db.zaxkmjqozvmbifiwbxps.supabase.co:5432/postgres',
    'postgresql://postgres:synthetic-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres?options=reference%3Dzaxkmjqozvmbifiwbxps',
  ]) assert.equal(await recoveryTarget('audit', { ...env, POSTGRES_URL_NON_POOLING: url,
    FITSY_PIPELINE_ROLES_APPROVED_SHA256: '' }), url);
  for (const value of [undefined, '', privateMarker]) {
    requests = [];
    await refused('resolve', { FITSY_ALLOW_PROD_WRITE: value }, /write intent: expected FITSY_ALLOW_PROD_WRITE=1; got /);
    assert.deepEqual(requests, []);
  }
});

test('other workflows, events, environments and stale or mismatched sources cannot authorize recovery', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ repository: 'other/fitsy' }, /OIDC repository: expected dgmolla\/fitsy; got /],
    [{ ref: 'refs/heads/feature' }, /OIDC ref: expected refs\/heads\/main; got /],
    [{ event_name: 'push' }, /OIDC event_name: expected workflow_dispatch; got /],
    [{ workflow_ref: 'dgmolla/fitsy/.github/workflows/prod-fixture-cleanup.yml@refs/heads/main' },
      /OIDC workflow_ref: expected dgmolla\/fitsy\/\.github\/workflows\/production-migration-recovery.yml@refs\/heads\/main; got /],
    [{ sub: 'repo:dgmolla/fitsy:environment:production-native' }, /OIDC sub: expected repo:dgmolla\/fitsy:environment:production-release; got /],
    [{ runner_environment: 'self-hosted' }, /OIDC runner_environment: expected github-hosted; got /],
    [{ sha: 'b'.repeat(40), workflow_sha: 'b'.repeat(40) }, /OIDC source: expected signed sha equal to GITHUB_SHA; got mismatch/],
    [{ sha: privateMarker }, /OIDC sha: expected 40 lowercase hex characters; got /],
    [{ workflow_sha: 'b'.repeat(40) }, /OIDC workflow_sha: expected equal to signed sha; got mismatch/],
    [{ iss: 'https://untrusted.invalid' }, /OIDC iss: expected https:\/\/token.actions.githubusercontent.com; got /],
    [{ aud: 'https://fitsy.org/database-write' }, /OIDC aud: expected https:\/\/fitsy.org\/hex-jobs-recovery; got /],
    [{ exp: 1 }, /OIDC exp: expected future numeric timestamp; got numeric timestamp outside allowed window/],
    [{ exp: undefined }, /OIDC exp: expected future numeric timestamp; got missing/],
    [{ exp: privateMarker }, /OIDC exp: expected future numeric timestamp; got nonempty string \(redacted\)/],
    [{ nbf: undefined }, /OIDC nbf: expected numeric timestamp at or before now; got missing/],
    [{ nbf: now + 600 }, /OIDC nbf: expected numeric timestamp at or before now; got numeric timestamp outside allowed window/],
    [{ nbf: privateMarker }, /OIDC nbf: expected numeric timestamp at or before now; got nonempty string \(redacted\)/],
    [{ iat: undefined }, /OIDC iat: expected numeric timestamp within the last 5 minutes; got missing/],
    [{ iat: now - 600 }, /OIDC iat: expected numeric timestamp within the last 5 minutes; got numeric timestamp outside allowed window/],
    [{ iat: now + 600 }, /OIDC iat: expected numeric timestamp within the last 5 minutes; got numeric timestamp outside allowed window/],
    [{ iat: privateMarker }, /OIDC iat: expected numeric timestamp within the last 5 minutes; got nonempty string \(redacted\)/],
  ];
  for (const claim of ['repository', 'ref', 'workflow_ref', 'event_name', 'runner_environment', 'sha', 'workflow_sha', 'iss', 'aud', 'sub']) {
    cases.push([{ [claim]: undefined }, new RegExp(`OIDC ${claim}: expected .*; got (?:mismatch \\()?missing`)]);
    for (const value of [privateMarker, { secret: privateMarker }, [privateMarker], null]) {
      cases.push([{ [claim]: value }, new RegExp(`OIDC ${claim}: expected `)]);
    }
  }
  for (const [overrides, reason] of cases) {
    issued = await token(overrides);
    for (const mode of ['audit', 'resolve'] as const) await refused(mode, {}, reason);
  }
  const foreign = await generateKeyPair('RS256');
  issued = await token({}, foreign.privateKey);
  await refused('resolve', {}, /OIDC signature: expected trusted RS256 signature; got invalid signature/);
  issued = 'invalid-synthetic-token';
  await refused('resolve', {}, /OIDC token format: expected compact signed JWT; got malformed token/);
  issued = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
  await refused('resolve', {}, /OIDC algorithm: expected RS256; got disallowed algorithm/);
  issued = await token();
  await refused('resolve', { GITHUB_SHA: privateMarker }, /OIDC source: expected signed sha equal to GITHUB_SHA; got mismatch/);
});

test('target or request changes fail before transmitting credentials and cannot approve role SQL', async () => {
  const cases: Array<[NodeJS.ProcessEnv, RegExp]> = [
    [{ POSTGRES_URL_NON_POOLING: undefined }, /database URL: expected POSTGRES_URL_NON_POOLING present; got missing or empty/],
    [{ POSTGRES_URL_NON_POOLING: privateMarker }, /database URL: expected parseable URL and encoded user; got malformed/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace('postgresql:', 'https:') }, /database protocol: expected postgres: or postgresql:; got another protocol/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace(':5432/', ':6543/') }, /database port: expected 5432 or default; got port 6543/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace('zaxkmjqozvmbifiwbxps', 'kegycybiruksmrzvniha') }, /database project: expected production project ref; got another project ref/],
    [{ POSTGRES_URL_NON_POOLING: 'postgresql://postgres:synthetic-password@localhost:5432/postgres' }, /database locality: expected remote production target; got loopback/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace(':5432/postgres', ':5432/' + privateMarker) }, /database name: expected \/postgres; got another database path/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace(':synthetic-password', '') }, /database password: expected present; got missing/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace('postgres.zax', privateMarker + '.zax') }, /database user: expected postgres or postgres\.<production-ref>; got another user/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING + '?options=reference%3Dkegycybiruksmrzvniha' }, /database project routes: expected consistent project refs; got conflicting routes/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING.replace('aws-1-us-east-1.pooler.supabase.com', privateMarker + '.invalid') }, /database host route: expected identified Supabase project or loopback; got unidentified route/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING + '?schema=' + privateMarker }, /database schema: expected absent or public; got another schema/],
    [{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING + '?pgbouncer=true' }, /database pooling: expected pgbouncer not equal to true; got pgbouncer=true present/],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: privateMarker }, /OIDC request URL: expected parseable URL; got missing or malformed/],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://untrusted.invalid/token' }, /OIDC request host: expected \.actions.githubusercontent.com suffix; got another hostname/],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://actions.githubusercontent.com.untrusted.invalid/token' }, /OIDC request host: expected \.actions.githubusercontent.com suffix; got another hostname/],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: request.replace('https:', 'http:') }, /OIDC request protocol: expected https:; got another protocol/],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: request.replace('https://', 'https://' + privateMarker + ':synthetic-password@') }, /OIDC request userinfo: expected absent; got username or password present/],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: request.replace('/token', ':8443/token') }, /OIDC request port: expected default HTTPS port; got port 8443/],
    [{ ACTIONS_ID_TOKEN_REQUEST_URL: request + '#' + privateMarker }, /OIDC request fragment: expected absent; got fragment present/],
    [{ ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }, /OIDC request credential: expected present; got empty string/],
    [{ ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined }, /OIDC request credential: expected present; got missing/],
    [{ GITHUB_ACTIONS: privateMarker }, /protected workflow: expected GITHUB_ACTIONS=true; got nonempty string \(redacted\)/],
    [{ FITSY_PIPELINE_ROLES_APPROVED_SHA256: privateMarker }, /role approval: expected FITSY_PIPELINE_ROLES_APPROVED_SHA256 unset or empty; got nonempty string \(redacted\)/],
  ];
  for (const suffix of ['?unknown=' + privateMarker, '?schema=public&schema=public',
    '?options=' + privateMarker, '?options=reference%3Dzaxkmjqozvmbifiwbxps&options=reference%3Dzaxkmjqozvmbifiwbxps', '#' + privateMarker]) {
    cases.push([{ POSTGRES_URL_NON_POOLING: env.POSTGRES_URL_NON_POOLING + suffix },
      /database routing parameters: expected supported unique parameters, valid reference option and no fragment; got unsupported routing shape/]);
  }
  for (const mode of ['audit', 'resolve'] as const) {
    for (const [overrides, reason] of cases) {
      requests = [];
      await refused(mode, overrides, reason);
      assert.deepEqual(requests, []);
    }
  }
});

test('provider failures stay private and cannot supply recovery authority', async () => {
  const transport = global.fetch;
  try {
    for (const [result, reason] of [
      ['throw', /OIDC request transport: expected successful token request; got transport failure/],
      ['http', /OIDC request response: expected successful HTTP status; got HTTP 503/],
      ['json', /OIDC response JSON: expected JSON object; got invalid JSON/],
      ['null', /OIDC response value: expected JWT string; got missing/],
      ['malformed', /OIDC response value: expected JWT string; got number/],
    ] as const) {
      global.fetch = async () => {
        if (result === 'throw') throw new Error('synthetic-provider-secret');
        return result === 'http' ? new Response('synthetic-provider-secret', { status: 503 })
          : result === 'json' ? new Response('synthetic-provider-secret')
            : Response.json(result === 'null' ? null : { value: 123, diagnostic: 'synthetic-provider-secret' });
      };
      await refused('resolve', {}, reason);
    }
    issued = await token();
    global.fetch = async (url, init) => {
      if (String(url) === issuer + '/.well-known/jwks') throw new Error('synthetic-provider-secret');
      return transport(url, init);
    };
    await refused('resolve', {}, /OIDC verification: expected trusted signing keys and valid JWT; got verification failure/);
  } finally { global.fetch = transport; }
});
