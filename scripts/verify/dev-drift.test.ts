import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const yaml = require('js-yaml') as { load(value: string): unknown };
const root = resolve(__dirname, '../..');
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fitsy-drift-'));
  mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
  mkdirSync(join(directory, 'prisma/migrations'), { recursive: true });
  mkdirSync(join(directory, 'bin'));
  for (const name of ['dirname', 'ls', 'grep', 'sort', 'comm', 'tr', 'cat', 'awk', 'bash']) {
    symlinkSync(execFileSync('which', [name], { encoding: 'utf8' }).trim(), join(directory, 'bin', name));
  }
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
const env = () => ({ PATH: join(directory, 'bin'), POSTGRES_URL_NON_POOLING: 'postgresql://fixture:fixture@localhost/fixture', LANG: process.env['LANG'], LC_ALL: process.env['LC_ALL'] });
function drift(applied: string[], queryFails: 'migrations' | 'seed' | undefined = undefined) {
  for (const name of ['20260901_A', '20260901_z', '20260828_init']) mkdirSync(join(directory, 'prisma/migrations', name));
  writeFileSync(join(directory, 'prisma/migrations/migration_lock.toml'), 'provider = "postgresql"');
  copyFileSync(join(root, 'scripts/verify/dev-drift.sh'), join(directory, 'scripts/verify/dev-drift.sh'));
  writeFileSync(join(directory, 'applied'), applied.join('\n') + '\n');
  writeFileSync(join(directory, 'bin/psql'), `#!/bin/sh
case "$3" in
  *migration_name*) ${queryFails === 'migrations' ? 'exit 1' : 'cat "$DRIFT_FIXTURE/applied"'} ;;
  *Restaurant*) printf '50\\n' ;;
  *MenuItem*) printf '400\\n' ;;
  *MacroEstimate*) ${queryFails === 'seed' ? 'exit 2' : "printf '400\\n'"} ;;
  *User*) printf '3\\n' ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  return spawnSync('/bin/bash', [join(directory, 'scripts/verify/dev-drift.sh')], { env: { ...env(), DRIFT_FIXTURE: directory }, encoding: 'utf8' });
}
test('the real drift CLI compares migration sets regardless of the database return order', () => {
  const result = drift(['20260828_init', '20260901_z', '20260901_A']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'pass', summary: expect.stringContaining('3 migrations') });
});
test('a missing migration remains a failed drift check', () => {
  const result = drift(['20260828_init', '20260901_z']);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('20260901_A') });
});
test('a database read failure is reported distinctly from migration drift', () => {
  const result = drift([], 'migrations');
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('read dev migration history') });
});
test('a dropped seed-query connection becomes a failed check, never a skip', () => {
  const result = drift(['20260828_init', '20260901_z', '20260901_A'], 'seed');
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: expect.stringContaining('read dev seed counts') });
});
test.each([0, 1, 2])('the actual scheduled step requires a completed pass (check exit %i)', code => {
  const workflow = yaml.load(readFileSync(join(root, '.github/workflows/dev-maintenance.yml'), 'utf8')) as { jobs: { nightly: { steps: { name?: string; run?: string }[] } } };
  const step = workflow.jobs.nightly.steps.find(s => s.name === 'Drift check')!.run!;
  writeFileSync(join(directory, 'scripts/verify/dev-drift.sh'), `exit ${code}\n`);
  writeFileSync(join(directory, 'bin/sudo'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const result = spawnSync('/bin/bash', ['-e', '-c', step], { cwd: directory, env: env(), encoding: 'utf8' });
  expect(result.status).toBe(code);
});
test.each([1, 3])('one failed check retains its early workspace error before later passing suite output (exit %i)', code => {
  const verify = join(directory, 'scripts/verify');
  copyFileSync(join(root, 'scripts/verify/run.mjs'), join(verify, 'run.mjs'));
  writeFileSync(join(verify, 'registry.yml'), 'checks:\n  - name: fixture\n    script: fixture.sh\n    layer: 2\n    blocking: true\n');
  writeFileSync(join(verify, 'fixture.sh'), `#!/bin/sh\nprintf '%s\\n' 'ORIGINAL_WORKSPACE_FAILURE' '${'later passing output '.repeat(400)}' >&2\nprintf '%s\\n' '{"name":"fixture","status":"fail","summary":"fixture failed"}'\nexit ${code}\n`);
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'));
  const result = spawnSync(process.execPath, [join(verify, 'run.mjs'), '--layer=2', '--scope=all'], { env: env(), encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('ORIGINAL_WORKSPACE_FAILURE');
  expect(JSON.parse(result.stdout)).toMatchObject({ name: 'fixture', status: 'fail' });
  expect(JSON.parse(result.stdout)).not.toHaveProperty('stderr');
});
