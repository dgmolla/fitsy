import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const root = resolve(__dirname, '../..');
let directory: string;
const allowlist = 'scripts/verify/structural-allowlist.txt';
const mobile = 'apps/mobile/app/search.tsx';
const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, stdio: 'pipe', encoding: 'utf8' }).trim();
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
function check() {
  return spawnSync('bash', ['scripts/verify/domain-check.sh'], { cwd: directory, encoding: 'utf8', env: { ...process.env, PR_NUMBER: '' } });
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
  const result = spawnSync(process.execPath, ['scripts/verify/domain-allowlist-paths.mjs', 'missing-head'], { cwd: directory, encoding: 'utf8', input: paths });
  expect(result.status).toBe(0); expect(result.stdout).toBe(paths);
});
