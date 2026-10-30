import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string;
const loopback = '127.0.0.1'; // loopback test fixture
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-smoke-origin-'));
  // External HTTP recorder. No request leaves the process, including accepted writes.
  writeFileSync(join(directory, 'curl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  *api/health*) printf '%s' "\${SMOKE_HEALTH_STATUS:-200}" ;;
  *'Authorization: Bearer invalid.jwt.signature'*) printf '%s' "\${SMOKE_INVALID_SESSION_STATUS:-401}" ;;
  *api/auth/login*seed-free*) printf '{"token":"free"}' ;;
  *api/auth/login*) printf '{"token":"pro"}' ;;
  *api/auth/register*) printf 201 ;;
  *'Authorization: Bearer free'*api/restaurants*) printf '{"meta":{"locked":true}}' ;;
  *'Authorization: Bearer pro'*api/restaurants*) printf '{"data":[{}],"meta":{"locked":false}}' ;;
  *) printf 401 ;;
esac
`, { mode: 0o755 });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function smoke(base: string, args = ['--write'], environment: Record<string, string> = {}) {
  const calls = join(directory, 'calls');
  rmSync(calls, { force: true });
  const result = spawnSync('bash', [resolve(__dirname, 'api-e2e.sh'), '--base=' + base, ...args], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${directory}:${process.env['PATH']}`, CALLS: calls, PROD_SMOKE_EMAIL: '', PROD_SMOKE_PASSWORD: '',
      SMOKE_HEALTH_STATUS: '200', SMOKE_INVALID_SESSION_STATUS: '401', ...environment },
  });
  expect(result.error).toBeUndefined();
  return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
}

test.each(['https://dev.fitsy.org', 'https://dev.fitsy.org/', 'http://localhost', 'http://localhost:3000/',
  `http://${loopback}`, `http://${loopback}:65535`])('write smoke accepts the complete intended origin: %s', base => {
  const result = smoke(base);
  expect({ status: result.status, output: result.stdout }).toEqual({ status: 0, output: expect.any(String) });
  expect(JSON.parse(result.stdout).status).toBe('pass');
  expect(result.calls).toContain(`${base.replace(/\/$/, '')}/api/auth/register`);
});

test.each(['https://dev.fitsy.org.attacker.invalid', 'https://dev.fitsy.org@attacker.invalid',
  'https://dev.fitsy.org:444', 'https://dev.fitsy.org/api', 'https://dev.fitsy.org?host=prod',
  'https://dev.fitsy.org#secret', 'http://localhost.attacker.invalid', 'http://localhost@attacker.invalid',
  `http://${loopback}.attacker.invalid`, `http://${loopback}0`, 'http://localhost:0', 'http://localhost:65536',
  'http://localhost:999999', 'http://localhost/../prod', 'http://localhost\\@attacker.invalid',
  'https://fitsy.org', 'https://fitsy-api-fixture.vercel.app', 'https://dev.fitsy.org/"synthetic-secret']) (
  'write smoke rejects lookalikes and URL decorations before any HTTP: %s', base => {
    const result = smoke(base);
    expect(result.status).toBe(1); expect(result.calls).toBe('');
    expect(JSON.parse(result.stdout).status).toBe('fail');
    expect(result.stdout).not.toContain('synthetic-secret');
  });

test.each([{ args: [] }, { args: ['--prod-safe'] }, { args: ['--write', '--prod-safe'] }])('production smoke stays read-only: %j', ({ args }) => {
  const result = smoke('https://fitsy.org', args);
  expect(result.status).toBe(0);
  expect(result.calls).not.toContain('api/auth/register');
});

test.each([580, 584])('incident %i fails despite healthy database and missing-session responses, then recovers', number => {
  const incident = JSON.parse(readFileSync(resolve(__dirname, `../deploy/__fixtures__/incident-${number}.json`), 'utf8'));
  const failed = smoke('https://fitsy.org', ['--prod-safe'], {
    SMOKE_HEALTH_STATUS: String(incident.smoke.health),
    SMOKE_INVALID_SESSION_STATUS: String(incident.smoke.invalid_session),
  });
  expect(failed.status).toBe(1);
  expect(JSON.parse(failed.stdout)).toMatchObject({
    status: 'fail', summary: incident.smoke.summary,
    fix: expect.stringContaining('shared rate-limit'),
  });
  expect(failed.stderr).toContain(`health -> ${incident.smoke.health}`);
  expect(failed.stderr).toContain(`unauth subscriptions/status (expect 401) -> ${incident.smoke.missing_session}`);
  expect(JSON.parse(failed.stdout).fix).toContain('UPSTASH_REDIS_REST_URL');
  expect(JSON.parse(failed.stdout).fix).toContain('UPSTASH_REDIS_REST_TOKEN');
  expect(JSON.parse(failed.stdout).fix).toContain('guarded Git build');
  expect(failed.calls).not.toMatch(/api\/auth\/(login|register)/);

  // Restoring readiness must still reject the same invalid token.
  const recovered = smoke('https://fitsy.org', ['--prod-safe']);
  expect(recovered.status).toBe(0);
  expect(JSON.parse(recovered.stdout)).toMatchObject({ status: 'pass', fix: '' });
  expect(recovered.stderr).toContain('invalid-session search (expect 401) -> 401');
  expect(recovered.calls).toBe(failed.calls);
});

test.each([
  { health: '503', invalid: '503' },
  { health: '200', invalid: '429' },
  { health: '200', invalid: '000' },
])('other smoke failures remain failures without a store-specific diagnosis: %j', ({ health, invalid }) => {
  const result = smoke('https://fitsy.org', ['--prod-safe'], {
    SMOKE_HEALTH_STATUS: health, SMOKE_INVALID_SESSION_STATUS: invalid,
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining(`invalid-session=${invalid}`) });
  expect(JSON.parse(result.stdout).fix).not.toContain('shared rate-limit');
});
