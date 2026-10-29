/** Signed identity for the incident-specific protected maintenance caller. */
import { databaseTarget, PROD_PROJECT_REF } from '../lib/db-target-guard';

export class RecoveryRefused extends Error {}
export const refuseRecovery = (reason: string): never => { throw new RecoveryRefused(`Recovery refused: ${reason}`); };

/** Keep the ordinary writer allowlist unchanged; this identity authorizes only this recovery. */
export async function recoveryTarget(mode: 'audit' | 'resolve', env = process.env) {
  try {
    const target = databaseTarget(env['POSTGRES_URL_NON_POOLING']);
    const url = new URL(target.url), username = decodeURIComponent(url.username);
    if (target.ref !== PROD_PROJECT_REF || target.local || url.pathname !== '/postgres' || !url.password ||
        !['postgres', `postgres.${PROD_PROJECT_REF}`].includes(username) || !['', '5432'].includes(url.port) ||
        (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') ||
        url.searchParams.get('pgbouncer') === 'true' || env['FITSY_PIPELINE_ROLES_APPROVED_SHA256'] ||
        (mode === 'resolve' && env['FITSY_ALLOW_PROD_WRITE'] !== '1')) throw new Error();
    const request = new URL(env['ACTIONS_ID_TOKEN_REQUEST_URL'] ?? '');
    if (env['GITHUB_ACTIONS'] !== 'true' || !env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'] ||
        request.protocol !== 'https:' || !request.hostname.endsWith('.actions.githubusercontent.com') ||
        request.username || request.password || request.port || request.hash) throw new Error();
    const audience = 'https://fitsy.org/hex-jobs-recovery';
    request.searchParams.set('audience', audience);
    const response = await fetch(request, {
      headers: { Authorization: `Bearer ${env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}` },
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error();
    const body = await response.json() as { value?: unknown };
    if (typeof body.value !== 'string') throw new Error();
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(body.value, createRemoteJWKSet(
      new URL('https://token.actions.githubusercontent.com/.well-known/jwks'), { timeoutDuration: 5000 }), {
      issuer: 'https://token.actions.githubusercontent.com', audience,
      subject: 'repo:dgmolla/fitsy:environment:production-release', algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'nbf'], maxTokenAge: '5m',
    });
    if (payload['repository'] !== 'dgmolla/fitsy' || payload['ref'] !== 'refs/heads/main' ||
        payload['workflow_ref'] !== 'dgmolla/fitsy/.github/workflows/production-migration-recovery.yml@refs/heads/main' ||
        payload['event_name'] !== 'workflow_dispatch' || payload['runner_environment'] !== 'github-hosted' ||
        !/^[a-f0-9]{40}$/.test(String(payload['sha'])) || payload['workflow_sha'] !== payload['sha'] ||
        payload['sha'] !== env['GITHUB_SHA']) throw new Error();
    return target.url;
  } catch { return refuseRecovery('requires the protected main recovery workflow, signed identity, exact production session target and explicit write intent; role approval must remain unset'); }
}

