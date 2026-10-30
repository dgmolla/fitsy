/** Signed identity for the incident-specific protected maintenance caller. */
import { databaseTarget, PROD_PROJECT_REF } from '../lib/db-target-guard';

export class RecoveryRefused extends Error {}
export const refuseRecovery = (reason: string): never => { throw new RecoveryRefused(`Recovery refused: ${reason}`); };

// Values may themselves contain credentials, including signed claims and provider errors.
// Report only types/presence, fixed routing shapes and URL-validated numeric ports.
function shape(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (typeof value === 'string') return value ? 'nonempty string (redacted)' : 'empty string';
  return Array.isArray(value) ? 'array (redacted)' : typeof value;
}
function requireShape(ok: boolean, check: string, expected: string, actual: string) {
  if (!ok) refuseRecovery(`${check}: expected ${expected}; got ${actual}`);
}

function productionTarget(value: string | undefined) {
  try { return databaseTarget(value); }
  catch (error) {
    // Translate only known static parser errors; never forward arbitrary exception text.
    const reasons = new Map<string, string>([
      ['database URL is required; load the DEV environment explicitly', 'database URL: expected POSTGRES_URL_NON_POOLING present; got missing or empty'],
      ['invalid database URL', 'database URL: expected parseable URL and encoded user; got malformed'],
      ['expected a PostgreSQL URL', 'database protocol: expected postgres: or postgresql:; got another protocol'],
      ['conflicting database project routes', 'database project routes: expected consistent project refs; got conflicting routes'],
      ['unsupported database routing parameters', 'database routing parameters: expected supported unique parameters, valid reference option and no fragment; got unsupported routing shape'],
      ['target must be an identified Supabase project or loopback database', 'database host route: expected identified Supabase project or loopback; got unidentified route'],
    ]);
    const reason = error instanceof Error ? error.message.replace(/^DB_WRITE_REFUSED: /, '') : '';
    return refuseRecovery(reasons.get(reason) ||
      'database target: expected supported production route; got validation failure (details withheld)');
  }
}

/** Keep the ordinary writer allowlist unchanged; this identity authorizes only this recovery. */
export async function recoveryTarget(mode: 'audit' | 'resolve', env = process.env) {
  let failure = 'database target: expected valid production session target; got validation failure (details withheld)';
  try {
    const target = productionTarget(env['POSTGRES_URL_NON_POOLING']);
    const url = new URL(target.url), username = decodeURIComponent(url.username);
    requireShape(!target.local, 'database locality', 'remote production target', 'loopback');
    requireShape(target.ref === PROD_PROJECT_REF, 'database project', 'production project ref', 'another project ref');
    requireShape(url.pathname === '/postgres', 'database name', '/postgres', 'another database path (redacted)');
    requireShape(!!url.password, 'database password', 'present', 'missing');
    requireShape(['postgres', `postgres.${PROD_PROJECT_REF}`].includes(username),
      'database user', 'postgres or postgres.<production-ref>', 'another user (redacted)');
    requireShape(['', '5432'].includes(url.port), 'database port', '5432 or default', `port ${url.port}`);
    requireShape(!url.searchParams.has('schema') || url.searchParams.get('schema') === 'public',
      'database schema', 'absent or public', 'another schema (redacted)');
    requireShape(url.searchParams.get('pgbouncer') !== 'true',
      'database pooling', 'pgbouncer not equal to true', 'pgbouncer=true present');
    requireShape(!env['FITSY_PIPELINE_ROLES_APPROVED_SHA256'], 'role approval',
      'FITSY_PIPELINE_ROLES_APPROVED_SHA256 unset or empty', shape(env['FITSY_PIPELINE_ROLES_APPROVED_SHA256']));
    if (mode === 'resolve') requireShape(env['FITSY_ALLOW_PROD_WRITE'] === '1',
      'write intent', 'FITSY_ALLOW_PROD_WRITE=1', shape(env['FITSY_ALLOW_PROD_WRITE']));
    failure = 'OIDC request URL: expected parseable URL; got missing or malformed';
    const request = new URL(env['ACTIONS_ID_TOKEN_REQUEST_URL'] ?? '');
    requireShape(env['GITHUB_ACTIONS'] === 'true', 'protected workflow', 'GITHUB_ACTIONS=true', shape(env['GITHUB_ACTIONS']));
    requireShape(!!env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'], 'OIDC request credential', 'present', shape(env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']));
    requireShape(request.protocol === 'https:', 'OIDC request protocol', 'https:', 'another protocol');
    requireShape(request.hostname.endsWith('.actions.githubusercontent.com'),
      'OIDC request host', '.actions.githubusercontent.com suffix', 'another hostname (redacted)');
    requireShape(!request.username && !request.password, 'OIDC request userinfo', 'absent', 'username or password present');
    requireShape(!request.port, 'OIDC request port', 'default HTTPS port', `port ${request.port}`);
    requireShape(!request.hash, 'OIDC request fragment', 'absent', 'fragment present');
    const audience = 'https://fitsy.org/hex-jobs-recovery';
    request.searchParams.set('audience', audience);
    failure = 'OIDC request transport: expected successful token request; got transport failure (details withheld)';
    const response = await fetch(request, {
      headers: { Authorization: `Bearer ${env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}` },
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    requireShape(response.ok, 'OIDC request response', 'successful HTTP status', `HTTP ${response.status}`);
    failure = 'OIDC response JSON: expected JSON object; got invalid JSON (details withheld)';
    const body = await response.json() as { value?: unknown } | null;
    requireShape(typeof body?.value === 'string', 'OIDC response value', 'JWT string', shape(body?.value));
    failure = 'OIDC verification: expected trusted signing keys and valid JWT; got verification failure (details withheld)';
    const { createRemoteJWKSet, jwtVerify, errors } = await import('jose');
    let payload: import('jose').JWTPayload;
    try {
      ({ payload } = await jwtVerify(body!.value as string, createRemoteJWKSet(
        new URL('https://token.actions.githubusercontent.com/.well-known/jwks'), { timeoutDuration: 5000 }), {
        issuer: 'https://token.actions.githubusercontent.com', audience,
        subject: 'repo:dgmolla/fitsy:environment:production-release', algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'nbf'], maxTokenAge: '5m',
      }));
    } catch (error) {
      if (error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired) {
        const expected = new Map([
          ['iss', 'https://token.actions.githubusercontent.com'], ['aud', audience],
          ['sub', 'repo:dgmolla/fitsy:environment:production-release'],
          ['exp', 'future numeric timestamp'], ['nbf', 'numeric timestamp at or before now'],
          ['iat', 'numeric timestamp within the last 5 minutes'],
        ]).get(error.claim);
        if (expected) return refuseRecovery(`OIDC ${error.claim}: expected ${expected}; got ${
          ['exp', 'nbf', 'iat'].includes(error.claim) && error.reason === 'check_failed'
            ? 'numeric timestamp outside allowed window' : shape(error.payload[error.claim])}`);
      }
      if (error instanceof errors.JWSSignatureVerificationFailed) return refuseRecovery(
        'OIDC signature: expected trusted RS256 signature; got invalid signature');
      if (error instanceof errors.JOSEAlgNotAllowed) return refuseRecovery('OIDC algorithm: expected RS256; got disallowed algorithm');
      if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return refuseRecovery(
        'OIDC token format: expected compact signed JWT; got malformed token');
      return refuseRecovery(failure);
    }
    for (const [claim, expected] of [
      ['repository', 'dgmolla/fitsy'], ['ref', 'refs/heads/main'],
      ['workflow_ref', 'dgmolla/fitsy/.github/workflows/production-migration-recovery.yml@refs/heads/main'],
      ['event_name', 'workflow_dispatch'], ['runner_environment', 'github-hosted'],
    ] as const) requireShape(payload[claim] === expected, `OIDC ${claim}`, expected, shape(payload[claim]));
    requireShape(/^[a-f0-9]{40}$/.test(String(payload['sha'])), 'OIDC sha', '40 lowercase hex characters', shape(payload['sha']));
    requireShape(payload['workflow_sha'] === payload['sha'], 'OIDC workflow_sha', 'equal to signed sha', `mismatch (${shape(payload['workflow_sha'])})`);
    requireShape(payload['sha'] === env['GITHUB_SHA'], 'OIDC source', 'signed sha equal to GITHUB_SHA', `mismatch (${shape(env['GITHUB_SHA'])})`);
    return target.url;
  } catch (error) {
    if (error instanceof RecoveryRefused) throw error;
    return refuseRecovery(failure);
  }
}

