import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = resolve(__dirname, '../..');
const fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
let directory: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', env: fixtureEnv });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-size-'));
  mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
  copyFileSync(join(root, 'scripts/verify/size-check.sh'), join(directory, 'scripts/verify/size-check.sh'));
  git('init', '-q');
  git('config', 'user.name', 'Local E2E');
  git('config', 'user.email', 'e2e@example.test');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(directory, 'README.md'), 'baseline\n');
  git('add', '.'); git('commit', '-qm', 'baseline');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test('an oversized coherent change reports review size without blocking other gates', () => {
  mkdirSync(join(directory, 'apps/api'), { recursive: true });
  writeFileSync(join(directory, 'apps/api/contract.ts'), Array.from({ length: 601 }, (_, index) => `export const line${index} = ${index};`).join('\n') + '\n');
  git('add', '.'); git('commit', '-qm', 'API contract');
  const result = spawnSync('bash', ['scripts/verify/size-check.sh'], { cwd: directory, encoding: 'utf8', env: fixtureEnv });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'pass', summary: '601 changed lines exceeds the 600-line review signal' });
});
