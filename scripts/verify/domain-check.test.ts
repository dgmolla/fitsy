import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const root = resolve(__dirname, '../..');
let directory: string;
// Git hooks export repository-local variables; fixture commands must not inherit them.
const fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const allowlist = 'scripts/verify/structural-allowlist.txt';
const mobile = 'apps/mobile/app/search.tsx';
const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe', encoding: 'utf8', env: fixtureEnv }).trim();
const write = (path: string, value: string) => writeFileSync(join(directory, path), value);
const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-domain-'));
  mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
  mkdirSync(join(directory, 'apps/mobile/app'), { recursive: true });
  for (const path of ['scripts/route-reviewers.sh', 'scripts/verify/domain-check.sh', 'scripts/verify/domain-allowlist-paths.mjs']) copyFileSync(join(root, path), join(directory, path));
  write(allowlist, `long-file ${mobile}\nconsole-log ${mobile}\n`);
  write(mobile, 'old screen');
  git('init', '-q'); git('config', 'user.name', 'Local E2E'); git('config', 'user.email', 'e2e@example.test'); git('config', 'core.hooksPath', '/dev/null');
  commit(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function check(extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', ['scripts/verify/domain-check.sh'], { cwd: directory, encoding: 'utf8', env: { ...fixtureEnv, PR_NUMBER: '', ...extraEnv } });
}
test('the real domain gate accepts a frontend fix that retires only its own exceptions', () => {
  write(mobile, 'shorter screen'); write(allowlist, ''); commit();
  const result = check();
  expect(result.status).toBe(0); expect(JSON.parse(result.stdout).summary).toBe('single domain: frontend');
});
test.each(['addition', 'unrelated removal', 'file deletion'])('the real gate retains infrastructure review for %s', scenario => {
  write(mobile, 'changed screen');
  if (scenario === 'addition') write(allowlist, readFileSync(join(directory, allowlist), 'utf8') + 'long-file apps/mobile/app/new.tsx\n');
  if (scenario === 'unrelated removal') { write(allowlist, ''); write(mobile, 'old screen'); write('apps/mobile/app/other.tsx', 'different screen'); }
  if (scenario === 'file deletion') rmSync(join(directory, allowlist));
  commit(); const result = check();
  expect(result.status).toBe(1); expect(JSON.parse(result.stdout).summary).toContain('cto frontend');
});
test('an allowlist-only cleanup retains its infrastructure owner', () => {
  write(allowlist, ''); commit(); const result = check();
  expect(result.status).toBe(0); expect(JSON.parse(result.stdout).summary).toBe('single domain: cto');
});
test('unreadable comparison history fails closed', () => {
  write(mobile, 'changed screen'); write(allowlist, ''); commit();
  const paths = `${mobile}\n${allowlist}\n`;
  const result = spawnSync(process.execPath, ['scripts/verify/domain-allowlist-paths.mjs', 'missing-head'], { cwd: directory, encoding: 'utf8', input: paths, env: fixtureEnv });
  expect(result.status).toBe(0); expect(result.stdout).toBe(paths);
});

test.each(['addition', 'unavailable'])('PR mode uses the remote head and fails closed for %s', scenario => {
  write(mobile, 'remote screen');
  write(allowlist, readFileSync(join(directory, allowlist), 'utf8') + `long-file apps/mobile/app/new.tsx\n`);
  commit(); const remoteHead = git('rev-parse', 'HEAD');
  git('checkout', '--detach', 'origin/main');
  write(mobile, 'local screen'); write(allowlist, ''); commit();
  expect(check().status).toBe(0);
  const bin = join(directory, 'bin'); mkdirSync(bin);
  const program = `#!/usr/bin/env node\nif (process.argv.includes('--name-only')) process.stdout.write(${JSON.stringify(mobile + '\n' + allowlist + '\n')}); else process.stdout.write(process.env.FIXTURE_PR_HEAD || '');\n`;
  writeFileSync(join(bin, 'gh'), program, { mode: 0o755 });
  const result = check({ PR_NUMBER: '1', FIXTURE_PR_HEAD: scenario === 'addition' ? remoteHead : '', PATH: bin + ':' + fixtureEnv.PATH });
  expect(result.status).toBe(1); expect(JSON.parse(result.stdout).summary).toContain('cto frontend');
});
test('unrecognized exception categories keep infrastructure ownership', () => {
  write(allowlist, `future-rule ${mobile}\n`); commit(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(mobile, 'changed screen'); write(allowlist, ''); commit();
  const result = check(); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).summary).toContain('cto frontend');
});
