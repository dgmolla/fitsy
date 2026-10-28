import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { assertDatabaseWriteAllowed, PROD_PROJECT_REF } from './db-target-guard';

// Only external OIDC issuance/JWKS transport is substituted. Real signatures,
// claims, the production guard and its caller execute unchanged.
const url = `postgresql://postgres.${PROD_PROJECT_REF}:synthetic@localhost:1/postgres`;
const owner = 'dawits-projects-74b6e00f';
const vercelIssuer = `https://oidc.vercel.com/${owner}`;
const githubIssuer = 'https://token.actions.githubusercontent.com';
const requestUrl = 'https://run-actions-1.services.actions.githubusercontent.com/fixture/token';
const originalFetch = global.fetch;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let issued = '', requests: string[] = [];
before(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'identity-fixture', alg: 'RS256', use: 'sig' };
  global.fetch = async input => {
    const address = String(input); requests.push(address);
    if (address.startsWith(requestUrl + '?')) return Response.json({ value: issued });
    assert.ok(['https://oidc.vercel.com/.well-known/jwks', `${githubIssuer}/.well-known/jwks`].includes(address));
    return Response.json({ keys: [jwk] });
  };
});
after(() => { global.fetch = originalFetch; });
const vercelClaims = {
  iss: vercelIssuer, aud: `https://vercel.com/${owner}`,
  sub: `owner:${owner}:project:fitsy-api:environment:production`,
  owner_id: 'team_VVc52BrZfx5IT2B1mDI5AuPT', project_id: 'prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4', environment: 'production',
};
const githubClaims = {
  iss: githubIssuer, aud: 'https://fitsy.org/database-write', sub: 'repo:dgmolla/fitsy:environment:production-release',
  repository: 'dgmolla/fitsy', ref: 'refs/heads/main', event_name: 'workflow_dispatch', runner_environment: 'github-hosted',
  workflow_ref: 'dgmolla/fitsy/.github/workflows/prod-fixture-cleanup.yml@refs/heads/main', sha: 'a'.repeat(40), workflow_sha: 'a'.repeat(40),
};
async function token(claims: Record<string, unknown>, overrides: Record<string, unknown> = {}, key = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iat: now, nbf: now, exp: now + 300, ...claims, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'identity-fixture' }).sign(key);
}
const vercel = {
  FITSY_ALLOW_PROD_WRITE: '1', VERCEL: '1', VERCEL_ENV: 'production', VERCEL_PROJECT_ID: vercelClaims.project_id,
  VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'dgmolla', VERCEL_GIT_REPO_SLUG: 'fitsy',
  VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
};
const github = {
  FITSY_ALLOW_PROD_WRITE: '1', GITHUB_ACTIONS: 'true', ACTIONS_ID_TOKEN_REQUEST_URL: requestUrl,
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-request-secret',
};

test('valid signed Vercel production and protected GitHub workflow identities preserve explicit intent', async () => {
  issued = await token(githubClaims);
  for (const env of [{ ...vercel, VERCEL_OIDC_TOKEN: await token(vercelClaims) },
    { ...vercel, VERCEL_OIDC_TOKEN: await token(vercelClaims, { iss: 'https://oidc.vercel.com' }) }, github]) {
    assert.equal(await assertDatabaseWriteAllowed(url, { env, args: ['--prod'] }), url);
    await assert.rejects(assertDatabaseWriteAllowed(url, { env, args: [] }), /DB_WRITE_REFUSED/);
    await assert.rejects(assertDatabaseWriteAllowed(url, { env: { ...env, FITSY_ALLOW_PROD_WRITE: '' }, args: ['--prod'] }), /DB_WRITE_REFUSED/);
  }
});

test('signed Vercel tokens from other projects, environments or issuers cannot authorize production', async () => {
  for (const overrides of [{ project_id: 'prj_other' }, { owner_id: 'team_other' }, { environment: 'preview' },
    { sub: 'owner:other:project:fitsy-api:environment:production' }, { aud: 'other' }, { iss: 'https://attacker.invalid' },
    { exp: 1 }, { nbf: Math.floor(Date.now() / 1000) + 600 }, { exp: undefined }, { iat: undefined }]) {
    await assert.rejects(assertDatabaseWriteAllowed(url, { env: { ...vercel, VERCEL_OIDC_TOKEN: await token(vercelClaims, overrides) }, args: ['--prod'] }), /signed.*identity/);
  }
  const foreign = await generateKeyPair('RS256');
  await assert.rejects(assertDatabaseWriteAllowed(url, { env: { ...vercel, VERCEL_OIDC_TOKEN: await token(vercelClaims, {}, foreign.privateKey) }, args: ['--prod'] }), /signed.*identity/);
});

test('signed GitHub tokens must bind main, the approved workflow, environment and manual event', async () => {
  for (const overrides of [{ repository: 'other/fitsy' }, { ref: 'refs/heads/feature' }, { event_name: 'pull_request' },
    { workflow_ref: 'dgmolla/fitsy/.github/workflows/verify.yml@refs/heads/main' }, { workflow_sha: 'b'.repeat(40) },
    { runner_environment: 'self-hosted' }, { sub: 'repo:dgmolla/fitsy:pull_request' },
    { aud: 'other' }, { iss: vercelIssuer }, { exp: 1 }, { exp: undefined }, { nbf: undefined }]) {
    issued = await token(githubClaims, overrides);
    await assert.rejects(assertDatabaseWriteAllowed(url, { env: github, args: ['--prod'] }), /signed.*identity/);
  }
});

test('forged request endpoints and identity provider failures fail privately before database access', async () => {
  for (const address of ['https://attacker.invalid/token', 'https://actions.githubusercontent.com.attacker.invalid/token',
    'http://run-actions-1.services.actions.githubusercontent.com/token', 'https://user:synthetic@run-actions-1.services.actions.githubusercontent.com/token']) {
    requests = [];
    await assert.rejects(assertDatabaseWriteAllowed(url, { env: { ...github, ACTIONS_ID_TOKEN_REQUEST_URL: address }, args: ['--prod'] }), /signed.*identity/);
    assert.deepEqual(requests, []);
  }
  const transport = global.fetch;
  global.fetch = async () => { throw new Error('synthetic-provider-secret'); };
  try {
    await assert.rejects(assertDatabaseWriteAllowed(url, { env: github, args: ['--prod'] }), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /DB_WRITE_REFUSED/);
      assert.ok(!error.message.includes('synthetic')); return true;
    });
  } finally { global.fetch = transport; }
});

test('unsigned, malformed and tampered tokens cannot turn copied flags into proof', async () => {
  const valid = await token(vercelClaims);
  const [header, payload, signature] = valid.split('.');
  const unsigned = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + payload + '.';
  const tampered = (signature![0] === 'A' ? 'B' : 'A') + signature!.slice(1);
  for (const forged of ['synthetic-invalid-token', unsigned, `${header}.${payload}.${tampered}`]) {
    await assert.rejects(assertDatabaseWriteAllowed(url, { env: { ...vercel, VERCEL_OIDC_TOKEN: forged }, args: ['--prod'] }), /signed.*identity/);
    issued = forged;
    await assert.rejects(assertDatabaseWriteAllowed(url, { env: github, args: ['--prod'] }), /signed.*identity/);
  }
});
