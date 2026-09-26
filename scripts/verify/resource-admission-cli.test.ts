import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const source = resolve(__dirname, '../..');
test.each([true, false])('actual runner preflight rejects=%s before other checks', deny => {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-resource-cli-'));
  const write = (path: string, value: string) => {
    const target = join(directory, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
  };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const marker = join(directory, 'test-ran');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8' });
  try {
    for (const file of ['run.mjs', 'impact-plan.mjs']) {
      const target = `scripts/verify/${file}`;
      write(target, readFileSync(join(source, target), 'utf8'));
    }
    write('scripts/verify/registry.yml', 'checks:\n  - name: admission\n    script: admission.sh\n    layer: 0\n    blocking: true\n    preflight: true\n  - name: test\n    script: fixture.sh\n    layer: 2\n    blocking: true\n');
    write('scripts/verify/admission.sh', '#!/bin/sh\n[ "$FITSY_TEST_DENY" != 1 ]\n');
    write('scripts/verify/fixture.sh', '#!/bin/sh\nprintf ran > "$FITSY_TEST_MARKER"\n');
    write('.gitignore', 'node_modules\n');
    symlinkSync(join(source, 'node_modules'), join(directory, 'node_modules'));
    git('init', '-q'); git('config', 'user.name', 'CLI test'); git('config', 'user.email', 'test@example.test');
    git('add', '-A'); git('commit', '-qm', 'fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const result = spawnSync(process.execPath, ['scripts/verify/run.mjs', '--layer=0-2', '--runs=local'],
      { cwd: directory, env: { ...env, FITSY_TEST_DENY: deny ? '1' : '0', FITSY_TEST_MARKER: marker },
        encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(deny ? 1 : 0);
    expect(existsSync(marker)).toBe(!deny);
    if (deny) expect(result.stdout).toContain('preflight failed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
