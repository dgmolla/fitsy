import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const script = resolve(__dirname, 'write-local-env.sh');

function run(project?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'write-local-env-'));
  try {
    mkdirSync(join(dir, 'scripts/dev'), { recursive: true });
    copyFileSync(script, join(dir, 'scripts/dev/write-local-env.sh'));
    if (project !== undefined) {
      mkdirSync(join(dir, '.vercel'));
      writeFileSync(join(dir, '.vercel/project.json'), JSON.stringify({ projectName: project }));
    }
    return spawnSync('bash', [join(dir, 'scripts/dev/write-local-env.sh')], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin:' + dirname(process.execPath) } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
describe('write-local-env Vercel project guard (#906 follow-up)', () => {
  test.each([['a worktree-named project', 'issue-904'], ['no link at all', undefined]])('refuses %s before pulling any env', (_name, project) => {
    const result = run(project as string | undefined);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not fitsy-api');
    expect(result.stderr).toContain('vercel link --yes --project fitsy-api');
  });
});
