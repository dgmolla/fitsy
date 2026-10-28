import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const cli = resolve(__dirname, 'preview-backend.mjs');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(GIT_|GITHUB_|FITSY_|EXPO_PUBLIC_)/.test(key)));
let root: string, head: string, previous: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env: cleanEnv, encoding: 'utf8' }).trim();
beforeAll(() => {
  root = mkdtempSync(resolve(tmpdir(), 'fitsy-preview-source-'));
  mkdirSync(resolve(root, 'apps/api'), { recursive: true });
  git('init', '-q'); git('config', 'user.name', 'Preview fixture'); git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(resolve(root, 'apps/api/source.txt'), 'stable dev\n');
  git('add', '.'); git('commit', '-qm', 'stable fixture'); previous = git('rev-parse', 'HEAD');
  writeFileSync(resolve(root, 'apps/api/source.txt'), 'candidate shuffle\n');
  git('add', '.'); git('commit', '-qm', 'candidate fixture'); head = git('rev-parse', 'HEAD');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const hostname = 'fitsy-immutable123-dawits-projects-74b6e00f.vercel.app';
const preview = 'https://' + hostname;
const deployment = (sha: string) => ({ id: 'dpl_fixture', name: 'fitsy-api', readyState: 'READY', target: null as string | null,
  source: 'git', gitSource: { sha }, meta: { githubCommitSha: sha } });

function execute({ stable = deployment(previous), detail = deployment(head),
  listed = [{ id: 'dpl_fixture', url: hostname, name: 'fitsy-api', state: 'READY', target: null,
    meta: { githubCommitSha: head } }] as { id?: string; url: string; name: string; state: string; target: string | null;
      meta: { githubCommitSha: string } }[], origin = 'https://dev.fitsy.org', sha = head, unavailable = false, dirty = false,
  aliasedCheckout = false } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'fitsy-preview-selection-'));
  const trace = resolve(dir, 'trace.jsonl');
  try {
    if (dirty) writeFileSync(resolve(root, 'apps/api/source.txt'), 'uncommitted API changes\n');
    writeFileSync(resolve(dir, 'vercel'), `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + '\\n');
if (${unavailable}) process.exit(1);
const result = args[0] === 'list' ? ${JSON.stringify({ deployments: listed })}
  : args[1].endsWith('dev.fitsy.org') ? ${JSON.stringify(stable)} : ${JSON.stringify(detail)};
process.stdout.write(JSON.stringify(result));
`, { mode: 0o755 });
    const alias = resolve(dir, 'checkout');
    if (aliasedCheckout) symlinkSync(resolve(__dirname, '../..'), alias, 'dir');
    const result = spawnSync(process.execPath, [aliasedCheckout ? resolve(alias, 'scripts/sim/preview-backend.mjs') : cli, sha], { cwd: root, encoding: 'utf8',
      env: { ...cleanEnv, PATH: dir + ':' + cleanEnv.PATH, FITSY_PRODUCT_ROOT: root, EXPO_PUBLIC_API_URL: origin } });
    let calls: string[][] = [];
    try { calls = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line)); } catch { /* Refused before calling Vercel. */ }
    return { ...result, calls };
  } finally {
    if (dirty) writeFileSync(resolve(root, 'apps/api/source.txt'), 'candidate shuffle\n');
    rmSync(dir, { recursive: true, force: true });
  }
}

test('stale stable dev selects the exact Ready PR preview before native work', () => {
  const result = execute();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ head, backend: preview, backendRevision: head, backendDeployment: 'dpl_fixture' });
  expect(result.calls).toEqual([
    ['api', '/v13/deployments/dev.fitsy.org', '--raw'],
    ['list', 'fitsy-api', '--scope', 'dawits-projects-74b6e00f', '--environment', 'preview', '--status', 'READY',
      '--meta', `githubCommitSha=${head}`, '--format', 'json'],
    ['api', '/v13/deployments/' + hostname, '--raw'],
  ]);
  expect(result.calls.every(args => ['api', 'list'].includes(args[0]!))).toBe(true);
});

test('the host temporary checkout alias still emits a verified preview identity', () => {
  // On macOS the poller launches /var/... while Node resolves the module to /private/var/....
  const result = execute({ aliasedCheckout: true });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).not.toBe('');
  expect(JSON.parse(result.stdout)).toEqual({ head, backend: preview, backendRevision: head, backendDeployment: 'dpl_fixture' });
  expect(result.calls).toHaveLength(3);
});

test('accepts the real Vercel listing shape without a deployment ID', () => {
  const result = execute({ listed: [{ url: hostname, name: 'fitsy-api', state: 'READY', target: null,
    meta: { githubCommitSha: head } }] });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ head, backend: preview, backendRevision: head, backendDeployment: 'dpl_fixture' });
});

test.each(['sim/product-flow.mjs', 'verify/product-flow.mjs', 'verify/media-integration.mjs', 'sim/slack-video.mjs'])(
  'native acceptance CLI %s also runs through an aliased checkout', entrypoint => {
    const dir = mkdtempSync(resolve(tmpdir(), 'fitsy-native-entrypoint-'));
    try {
      const alias = resolve(dir, 'checkout');
      symlinkSync(resolve(__dirname, '../..'), alias, 'dir');
      const planning = entrypoint === 'verify/product-flow.mjs';
      const result = spawnSync(process.execPath, [resolve(alias, 'scripts', entrypoint), planning ? '--plan' : 'invalid'], {
        cwd: root, encoding: 'utf8', env: { ...cleanEnv, FITSY_PRODUCT_ROOT: root, CI: '1', FITSY_DIFF_BASE: '' },
      });
      expect(result.status).toBe(1);
      if (planning) expect(JSON.parse(result.stdout)).toMatchObject({ name: 'product-flow', status: 'fail',
        summary: 'CI must supply the candidate diff base' });
      else expect(result.stderr.trim()).not.toBe('');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
);

test.each(['https://dev.fitsy.org', preview])('a matching configured backend stays selected: %s', origin => {
  const result = execute({ stable: deployment(head), origin });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).backend).toBe(origin);
  expect(result.calls).toHaveLength(1);
});

test('a configured preview cannot silently fall back to another deployment', () => {
  const result = execute({ origin: preview, detail: deployment(previous) });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Deploy candidate backend');
  expect(result.calls).toHaveLength(1);
});

const invalidPreviews: [string, () => Parameters<typeof execute>[0]][] = [
  ['missing', () => ({ listed: [] })],
  ['stale', () => ({ detail: { ...deployment(head), gitSource: { sha: previous } } })],
  ['building', () => ({ detail: { ...deployment(head), readyState: 'BUILDING' } })],
  ['production', () => ({ detail: { ...deployment(head), target: 'production' } })],
  ['another project', () => ({ detail: { ...deployment(head), name: 'other-project' } })],
  ['changed deployment ID', () => ({ detail: { ...deployment(head), id: 'dpl_replaced' } })],
];
test.each(invalidPreviews)('%s preview fails without stable-dev fallback', (_name, input) => {
  expect(execute(input()).status).toBe(1);
});

test.each(['https://api.fitsy.org', 'https://unrelated.vercel.app'])('refuses unsafe configured origin: %s', origin => {
  const result = execute({ origin });
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
});

test.each(['HEAD', 'another checkout'])('refuses an invalid or different checkout head: %s', label => {
  const result = execute({ sha: label === 'HEAD' ? label : previous });
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
});

test('unavailable deployment inspection fails without another request or native launch', () => {
  const result = execute({ unavailable: true });
  expect(result.status).toBe(1);
  expect(result.calls).toHaveLength(1);
});

test('a Ready exact-head preview cannot conceal uncommitted API changes', () => {
  const result = execute({ dirty: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Deploy candidate backend');
});
