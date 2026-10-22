import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const source = resolve(__dirname, '../..');
type DatabaseCase = { name: string; hijack: boolean; deny: boolean; unlocked: boolean;
  checkFailure: boolean; devDrift: boolean; focused?: boolean; missing?: boolean;
  scriptFocused?: boolean; wholeGroup?: string };
test.each<DatabaseCase>([
  ...['api', 'scripts', 'mobile'].map(wholeGroup => ({ name: `whole ${wholeGroup} group`, wholeGroup,
    hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false })),
  { name: 'whole scripts with changed owner', wholeGroup: 'scripts', hijack: true, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'failed whole scripts group', wholeGroup: 'scripts', hijack: false, deny: false, unlocked: false, checkFailure: true, devDrift: false },
  { name: 'focused script without caller URL', scriptFocused: true, focused: true, missing: true, hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'focused script with caller URL', scriptFocused: true, focused: true, missing: false, hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'focused API with caller URL', focused: true, missing: false, hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'focused API without caller URL', focused: true, missing: true, hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'healthy', hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'owner changed', hijack: true, deny: false, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'preflight failed', hijack: false, deny: true, unlocked: false, checkFailure: false, devDrift: false },
  { name: 'without OS lock', hijack: false, deny: false, unlocked: true, checkFailure: false, devDrift: false },
  { name: 'failing database check', hijack: false, deny: false, unlocked: false, checkFailure: true, devDrift: false },
  { name: 'dev drift retains caller URL', hijack: false, deny: false, unlocked: false, checkFailure: false, devDrift: true },
])('local database runner $name owns admission, URL and post-seed identity', ({ hijack, deny, unlocked, checkFailure, devDrift, focused = false, missing = false, scriptFocused = false, wholeGroup = '' }) => {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-db-cli-'));
  const write = (path: string, value: string) => {
    const target = join(directory, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
  };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(GIT_|GITHUB_|FITSY_DIFF_|FITSY_RUNS$|CI$|PR_NUMBER$)/.test(key) &&
    !key.startsWith('FITSY_VERIFY_') && key !== 'FITSY_LOCAL_DB'));
  // Runtime data must not become unknown changed source in group selection.
  const data = wholeGroup ? join(directory, '.evidence') : directory;
  mkdirSync(data, { recursive: true });
  const state = join(data, 'docker-state.json');
  const reset = join(data, 'reset');
  const devUrl = join(data, 'dev-url');
  const loopback = ['127', '0', '0', '1'].join('.');
  const owner = createHash('sha256').update(realpathSync(directory)).digest('hex').slice(0, 16);
  Object.assign(env, { PATH: `${join(directory, 'bin')}:${env.PATH}`, FITSY_TEST_STATE: state,
    FITSY_TEST_RESET: reset, FITSY_TEST_OWNER: owner, FITSY_TEST_HIJACK: hijack ? '1' : '0',
    FITSY_TEST_DENY: deny ? '1' : '0', FITSY_TEST_CHECK_FAIL: checkFailure ? '1' : '0', FITSY_TEST_DEV_URL: devUrl,
    POSTGRES_PRISMA_URL: 'postgresql://external.example/prod',
    POSTGRES_URL_NON_POOLING: 'postgresql://external.example/prod' });
  if (missing) { delete env.POSTGRES_PRISMA_URL; delete env.POSTGRES_URL_NON_POOLING; }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8' }).trim();
  try {
    for (const file of ['run.mjs', 'impact-plan.mjs', 'local-db.mjs', 'db-lock.py', 'docker-runtime.mjs']) {
      const target = `scripts/verify/${file}`;
      write(target, readFileSync(join(source, target), 'utf8'));
    }
    write('scripts/verify/registry.yml', 'checks:\n  - name: admission\n    script: admission.sh\n    layer: 0\n    blocking: true\n    preflight: true\n  - name: db-fixture\n    script: fixture.sh\n    layer: 2\n    blocking: true\n    database: true\n');
    if (wholeGroup) {
      write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8')
        .replace('name: db-fixture', 'name: test').replace('script: fixture.sh', 'script: test.sh'));
      write('scripts/verify/test.sh', readFileSync(join(source, 'scripts/verify/test.sh'), 'utf8'));
      const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
      const python = execFileSync('/usr/bin/which', ['python3'], { env, encoding: 'utf8' }).trim();
      write('bin/node', `#!/bin/sh
if [ "$1" != --test ]; then exec ${quote(process.execPath)} "$@"; fi
echo scripts-node >> .evidence/groups
[ "$FITSY_TEST_CHECK_FAIL" != 1 ]
`);
      write('bin/python3', `#!/bin/sh
case "$1" in *.test.py) echo scripts-python >> .evidence/groups; [ "$FITSY_TEST_CHECK_FAIL" != 1 ] ;; *) exec ${quote(python)} "$@" ;; esac
`);
      write('bin/npm', `#!/bin/sh
[ "$FITSY_VERIFY_DB_LOCKED" = 1 ] && [ -f "$FITSY_TEST_RESET" ] &&
  [ "$POSTGRES_PRISMA_URL" = 'postgresql://fitsy_test:fitsy_test@${loopback}:55432/fitsy_verify' ] &&
  [ "$POSTGRES_URL_NON_POOLING" = "$POSTGRES_PRISMA_URL" ] || exit 1
case "$*" in *--workspace=apps/api*) group=api ;; *--workspace=@fitsy/scripts*) group=scripts ;; *--workspace=@fitsy/mobile*) group=mobile ;; *) exit 1 ;; esac
echo "$group" >> .evidence/groups
[ "$FITSY_TEST_CHECK_FAIL" != 1 ]
`);
      for (const name of ['node', 'python3', 'npm']) chmodSync(join(directory, 'bin', name), 0o755);
    }
    if (focused) {
      write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8').replace('name: db-fixture', 'name: focused-tests').replace('layer: 2', 'layer: 1'));
      write('.evidence/verify/focused-tests.json', JSON.stringify({ version: 1, tests: [scriptFocused ? 'scripts/hex-resume.test.ts' : 'apps/api/fixture.test.ts'] }));
    }
    if (devDrift) {
      write('scripts/verify/registry.yml', readFileSync(join(directory, 'scripts/verify/registry.yml'), 'utf8') +
        '  - name: dev-drift\n    script: dev-drift.sh\n    layer: 3\n    blocking: shadow\n');
      write('scripts/verify/dev-drift.sh', '#!/bin/sh\nprintf "%s" "$POSTGRES_URL_NON_POOLING" > "$FITSY_TEST_DEV_URL"\necho \'{"summary":"dev drift checked"}\'\n');
    }
    write('scripts/verify/admission.sh', '#!/bin/sh\n[ "$FITSY_TEST_DENY" != 1 ]\n');
    write('scripts/verify/fixture.sh', `#!/bin/sh\n[ "$FITSY_VERIFY_DB_LOCKED" = 1 ] && [ -f "$FITSY_TEST_RESET" ] &&
  [ "$POSTGRES_PRISMA_URL" = 'postgresql://fitsy_test:fitsy_test@${loopback}:55432/fitsy_verify' ] &&
  [ "$POSTGRES_URL_NON_POOLING" = "$POSTGRES_PRISMA_URL" ] || exit 1
printf '%s\\n' '{"summary":"owned database check executed"}'\n`);
    if (checkFailure) write('scripts/verify/fixture.sh', readFileSync(join(directory, 'scripts/verify/fixture.sh'), 'utf8') + 'exit 1\n');
    write('bin/docker', `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2); const state=process.env.FITSY_TEST_STATE;
if(args[0]==='inspect') { if(!fs.existsSync(state)) { process.stderr.write('No such object'); process.exit(1); }
  process.stdout.write(JSON.stringify([JSON.parse(fs.readFileSync(state,'utf8'))])+'\\n'); }
else if(args[0]==='run') { fs.writeFileSync(state,JSON.stringify({Id:'owned-id',Image:'sha256:fixture',
  Config:{Image:'postgis/postgis:16-3.4',Labels:{'fitsy.verify.owner':process.env.FITSY_TEST_OWNER}},
  State:{Running:true},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'${loopback}',HostPort:'55432'}]}}}));
  process.stdout.write('owned-id\\n'); }
else if(args[0]==='exec') { if(args.includes('psql')) fs.writeFileSync(process.env.FITSY_TEST_RESET,'reset'); }
else process.exit(1);
`);
    chmodSync(join(directory, 'bin/docker'), 0o755);
    mkdirSync(join(directory, 'node_modules'), { recursive: true });
    symlinkSync(join(source, 'node_modules/js-yaml'), join(directory, 'node_modules/js-yaml'));
    write('node_modules/prisma/build/index.js', "process.exit(0);\n");
    write('node_modules/tsx/dist/cli.mjs', `import fs from 'node:fs';
if (process.env.FITSY_TEST_HIJACK === '1') {
  const state = JSON.parse(fs.readFileSync(process.env.FITSY_TEST_STATE, 'utf8'));
  state.Config.Labels['fitsy.verify.owner'] = 'another-owner';
  fs.writeFileSync(process.env.FITSY_TEST_STATE, JSON.stringify(state));
}
`);
    write('.gitignore', 'node_modules\n.evidence\n');
    git('init', '-q'); git('config', 'user.name', 'CLI test'); git('config', 'user.email', 'test@example.test');
    git('add', '-A'); git('commit', '-qm', 'fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    if (wholeGroup) {
      write(wholeGroup === 'scripts' ? 'scripts/review/example.py' : `apps/${wholeGroup}/lib/example.ts`, 'changed = true\n');
      git('add', '-A'); git('commit', '-qm', 'group candidate');
    }
    const result = spawnSync(process.execPath, unlocked
      ? ['scripts/verify/local-db.mjs', '--locked-run', '--only=admission,db-fixture', '--runs=local']
      : ['scripts/verify/run.mjs', `--only=admission,${wholeGroup ? 'test' : focused ? 'focused-tests' : 'db-fixture'}${devDrift ? ',dev-drift' : ''}`, '--runs=local'],
      { cwd: directory, env, encoding: 'utf8', timeout: 15000 });
    expect(result.status).toBe(hijack || deny || unlocked || checkFailure ? 1 : 0);
    if (unlocked) {
      expect(existsSync(state)).toBe(false);
      expect(existsSync(reset)).toBe(false);
      expect(result.stdout).toContain('owned verification database lock is missing');
    } else if (deny) {
      expect(existsSync(state)).toBe(false);
      expect(existsSync(reset)).toBe(false);
      expect(result.stdout).toContain('preflight failed');
    } else if (hijack) {
      expect(existsSync(reset)).toBe(true);
      expect(result.stdout).toContain('refusing a database container with different ownership or image');
      expect(result.stdout).not.toContain('owned database check executed');
      if (wholeGroup) expect(existsSync(join(directory, '.evidence/groups'))).toBe(false);
    } else {
      expect(existsSync(reset)).toBe(true);
      if (wholeGroup) {
        const groups = readFileSync(join(directory, '.evidence/groups'), 'utf8').trim().split('\n');
        expect(groups.filter(group => ['api', 'scripts', 'mobile'].includes(group))).toEqual([wholeGroup]);
        expect(groups.includes('scripts-node')).toBe(wholeGroup === 'scripts');
        expect(groups.includes('scripts-python')).toBe(wholeGroup === 'scripts');
        expect(result.stdout).toContain(`"name":"test","status":"${checkFailure ? 'fail' : 'pass'}"`);
      } else {
        expect(result.stdout).toContain('owned database check executed');
        if (checkFailure) expect(result.stdout).toContain('"name":"db-fixture","status":"fail"');
      }
      if (devDrift) expect(readFileSync(devUrl, 'utf8')).toBe('postgresql://external.example/prod');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
