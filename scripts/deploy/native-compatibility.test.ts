import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(__dirname, '../..');
let root: string;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
function git(...args: string[]) {
  return execFileSync('git', args, { cwd: root, env: cleanEnv, encoding: 'utf8' }).trim();
}
function write(path: string, value: string) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), value);
}
function check(production = false, google = 'expected.apps.googleusercontent.com') {
  return spawnSync('node', ['scripts/deploy/native-compatibility.mjs', ...(production ? ['--production-env'] : [])],
    { cwd: root, encoding: 'utf8', env: { ...cleanEnv, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: google } });
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-ota-'));
  git('init', '-q'); git('config', 'user.name', 'Fitsy test'); git('config', 'user.email', 'test@fitsy.invalid');
  write('apps/mobile/app.config.ts', 'native configuration');
  write('package-lock.json', '{}');
  write('apps/mobile/assets/icon.png', 'icon');
  git('add', '.'); git('commit', '-qm', 'binary source');
  const source = git('rev-parse', 'HEAD');
  write('scripts/deploy/ios-binary-baseline.json', JSON.stringify({
    ...JSON.parse(readFileSync(join(repo, 'scripts/deploy/ios-binary-baseline.json'), 'utf8')),
    source_sha: source, google_ios_client_id: 'expected.apps.googleusercontent.com',
  }));
  copyFileSync(join(repo, 'scripts/deploy/native-compatibility.mjs'), join(root, 'scripts/deploy/native-compatibility.mjs'));
  git('add', '.'); git('commit', '-qm', 'verified baseline');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('accepts later JS and the explicitly verified bundle-only screenshot', () => {
  write('apps/mobile/app/index.tsx', 'new JavaScript');
  write('apps/mobile/assets/app-screenshot.png', 'bundle image');
  git('add', '.'); git('commit', '-qm', 'JS release');
  const result = check(true);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ compatible: true, platform: 'ios', production_env_checked: true });
});

test.each(['package-lock.json', 'apps/mobile/app.config.ts', 'apps/mobile/eas.json',
  'apps/mobile/assets/icon.png', 'apps/mobile/assets/new-sound.wav', 'apps/mobile/ios/new.m',
  'apps/mobile/android/new.java', 'patches/native.patch', 'apps/mobile/plugins/native.js',
  'apps/mobile/app.config.js', 'apps/mobile/.eas/build/native.sh'])('blocks committed native input %s', path => {
  write(path, 'changed native input'); git('add', '.'); git('commit', '-qm', 'native release');
  const result = check();
  expect(result.status).toBe(1); expect(result.stderr).toContain('ship and verify a binary');
});

test.each(['apps/mobile/app.config.ts', 'apps/mobile/ios/untracked.m'])('blocks dirty or untracked native input %s', path => {
  write(path, 'uncommitted native input'); expect(check().status).toBe(1);
});
test('blocks missing baseline ancestry, malformed receipts and changed production scheme', () => {
  expect(check(true, 'different.apps.googleusercontent.com').status).toBe(1);
  expect(check(true, '').status).toBe(1);
  const path = join(root, 'scripts/deploy/ios-binary-baseline.json');
  const baseline = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...baseline, source_sha: '1'.repeat(40) }));
  expect(check().status).toBe(1);
  writeFileSync(path, JSON.stringify({ ...baseline, platform: 'android' }));
  expect(check().status).toBe(1);
  rmSync(path); expect(check().status).toBe(1);
});

test('uses the real Deploy step to deny an incompatible binary', () => {
  const yaml = require('js-yaml') as { load: (input: string) => {
    jobs: { ota: { steps: { id?: string; run?: string }[] } } } };
  const workflow = yaml.load(readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8'));
  const command = workflow.jobs.ota.steps.find(step => step.id === 'nativecheck')!.run!;
  const output = join(root, 'outputs.txt');
  function execute() {
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-c', command], { cwd: root, env: { ...cleanEnv, GITHUB_OUTPUT: output } });
    expect(result.status).toBe(0); return readFileSync(output, 'utf8');
  }
  expect(execute()).toContain('unsafe=false');
  write('apps/mobile/assets/icon.png', 'changed icon');
  expect(execute()).toContain('unsafe=true');
});

test('actual production helper prevents unsafe publication and exports only verified iOS', () => {
  copyFileSync(join(repo, 'scripts/deploy/ota.sh'), join(root, 'scripts/deploy/ota.sh'));
  write('.gitignore', '.evidence/\n');
  git('add', '.'); git('commit', '-qm', 'helper');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const bin = join(root, '.git/bin'); mkdirSync(bin);
  const log = join(root, '.git/eas-calls');
  writeFileSync(join(bin, 'npx'), `#!/bin/bash\nset -eu\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\nenv:exec) bash -c "$4" ;;\nupdate) printf '[{"group":"test-group"}]' ;;\nupdate:list) printf '{"currentPage":[{"group":"test-group"}]}' ;;\n*) exit 99 ;;\nesac\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const run = (google: string) => spawnSync('bash', ['scripts/deploy/ota.sh', 'test release'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`,
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: google },
  });
  expect(run('different.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8')).not.toContain('update --platform');
  const accepted = run('expected.apps.googleusercontent.com');
  expect(accepted.status).toBe(0);
  expect(accepted.stdout).toContain('verified: production branch serves group test-group');
  expect(readFileSync(log, 'utf8')).toContain('update --platform ios --branch production --environment production');
  write('apps/mobile/app/index.tsx', 'dirty JS');
  const before = readFileSync(log, 'utf8');
  expect(run('expected.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8')).toBe(before);
  rmSync(join(root, 'apps/mobile/app/index.tsx'));
  write('new.txt', 'candidate'); git('add', '.'); git('commit', '-qm', 'unmerged candidate');
  expect(run('expected.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8')).toBe(before);
});

test('actual rollback helper keeps a dual-platform prior group on iOS only', () => {
  copyFileSync(join(repo, 'scripts/deploy/rollback.sh'), join(root, 'scripts/deploy/rollback.sh'));
  const bin = join(root, '.git/bin'); mkdirSync(bin);
  const log = join(root, '.git/eas-calls');
  writeFileSync(join(bin, 'npx'), `#!/bin/bash\nset -eu\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\nupdate:list) printf '{"currentPage":[{"group":"current","message":"now"},{"group":"prior","message":"before","platforms":"android, ios"}]}' ;;\nupdate:republish) exit 0 ;;\n*) exit 99 ;;\nesac\n`, { mode: 0o755 });
  const result = spawnSync('bash', ['scripts/deploy/rollback.sh', 'mobile', 'prior'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}` },
  });
  expect(result.status).toBe(0);
  expect(readFileSync(log, 'utf8')).toContain('update:republish --platform ios --group prior');
});

test('the native guard checks its checkout despite inherited Git hook metadata', () => {
  const result = spawnSync('node', ['scripts/deploy/native-compatibility.mjs'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, GIT_WORK_TREE: repo, GIT_INDEX_FILE: '/missing-index' },
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).source_sha).toBe(git('rev-parse', 'HEAD'));
});
