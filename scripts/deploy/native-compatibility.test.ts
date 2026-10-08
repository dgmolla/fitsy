import { installGithubFixture } from './ota-test-fixtures';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(__dirname, '../..');
let root: string;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
function git(...args: string[]) {
  if (args[0] === 'update-ref' && args[1] === 'refs/remotes/origin/main')
    execFileSync('git', ['update-ref', 'refs/heads/main', args[2]!], { cwd: root, env: cleanEnv });
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
  git('init', '-q'); git('remote', 'add', 'origin', root); git('config', 'user.name', 'Fitsy test'); git('config', 'user.email', 'test@fitsy.invalid');
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
test('blocks ignored iOS native inputs under the real repository ignore rules', () => {
  write('.gitignore', readFileSync(join(repo, '.gitignore'), 'utf8'));
  git('add', '.gitignore'); git('commit', '-qm', 'repository ignores');
  write('apps/mobile/ios/untracked.m', 'native method unavailable in build 5');
  expect(git('status', '--porcelain')).toBe('');
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('ship and verify a binary');
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
  copyFileSync(join(repo, 'scripts/deploy/ota-hold.sh'), join(root, 'scripts/deploy/ota-hold.sh'));
  copyFileSync(join(repo, 'scripts/deploy/ota-lock.sh'), join(root, 'scripts/deploy/ota-lock.sh'));
  write('.gitignore', '.evidence/\n');
  git('add', '.'); git('commit', '-qm', 'helper');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const bin = join(root, '.git/bin'); mkdirSync(bin);
  const log = join(root, '.git/eas-calls');
  const holdState = join(root, '.git/hold-state');
  writeFileSync(holdState, '[[]]');
  const leaseState = join(root, '.git/lease-state');
  installGithubFixture(bin, holdState, leaseState);
  writeFileSync(join(bin, 'npx'), `#!/bin/bash\nset -eu\n[ -z "\${GH_TOKEN:-}" ] && [ -z "\${GITHUB_TOKEN:-}" ] || exit 88\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\nenv:exec) bash -c "$4" ;;\nupdate) [ ! -f '${log}.fail' ] || exit 7; printf '[{"group":"test-group"}]' ;;\nupdate:list) printf '{"currentPage":[{"group":"test-group"}]}' ;;\n*) exit 99 ;;\nesac\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const run = (google: string) => spawnSync('bash', ['scripts/deploy/ota.sh', 'test release'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`,
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: google, GH_TOKEN: 'fixture-repository-token', GITHUB_TOKEN: 'fixture-repository-token' },
  });
  expect(run('different.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8')).not.toContain('update --platform');
  const accepted = run('expected.apps.googleusercontent.com');
  expect(accepted.status).toBe(0);
  expect(accepted.stdout).toContain('verified: production branch serves group test-group');
  expect(readFileSync(log, 'utf8')).toContain('update --platform ios --branch production --environment production');
  // Actual two-push race: A has the pending mobile JS, then API-only B moves
  // origin/main before A's serialized Deploy reaches the publication helper.
  const mobileHead = git('rev-parse', 'HEAD');
  write('apps/api/app/api/health/route.ts', 'later API-only change');
  git('add', '.'); git('commit', '-qm', 'API-only push B');
  const apiHead = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', apiHead);
  git('checkout', '-q', '--detach', mobileHead);
  const yaml = require('js-yaml') as { load: (input: string) => {
    jobs: { changes: { steps: { id?: string; run?: string }[] }; ota: { if: string }; smoke: { if: string } } } };
  const workflow = yaml.load(readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8'));
  const changes = workflow.jobs.changes.steps.find(step => step.id === 'f')!.run!
    .replaceAll('${{ github.event.before }}', mobileHead).replaceAll('${{ github.sha }}', apiHead);
  const output = join(root, '.git/change-outputs');
  const classified = spawnSync('bash', ['-e', '-c', changes], { cwd: root,
    env: { ...cleanEnv, GITHUB_OUTPUT: output } });
  expect(classified.status).toBe(0);
  expect(readFileSync(output, 'utf8')).toContain('mobile=false');
  const queuedPublication = run('expected.apps.googleusercontent.com');
  expect(queuedPublication.status).toBe(0);
  expect(queuedPublication.stdout).toContain('verified: production branch serves group test-group');
  // B has no new mobile JS, so successful publication of integrated A serves
  // the current mobile contents without requiring B to retry A's missing OTA.
  // GitHub may replace pending A entirely while another Deploy is active.
  // Evaluate the actual surviving B job guard and run the actual helper: its
  // API-only classification must not suppress publication of A's mobile JS.
  git('checkout', '-q', '--detach', apiHead);
  const runSurvivor = (migration: string, smoke: string) => {
    const condition = workflow.jobs.ota.if.replaceAll('always()', 'true')
      .replaceAll('needs.changes.outputs.mobile', "'false'")
      .replaceAll('needs.migrate.result', `'${migration}'`)
      .replaceAll('needs.smoke.result', `'${smoke}'`);
    return spawnSync('bash', ['-e', '-c', `if [[ ${condition} ]]; then bash scripts/deploy/ota.sh 'surviving API push'; fi`], {
      cwd: root, encoding: 'utf8', env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`,
        EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'expected.apps.googleusercontent.com' },
    });
  };
  const survivingPublication = runSurvivor('success', 'success');
  expect(survivingPublication.status).toBe(0);
  expect(survivingPublication.stdout).toContain(`"source_sha":"${apiHead}"`);
  expect(survivingPublication.stdout).toContain('verified: production branch serves group test-group');
  const safeCalls = readFileSync(log, 'utf8');
  const blockedStates: Array<[string, string]> = [['failure', 'skipped'], ['cancelled', 'skipped'], ['success', 'failure'], ['success', 'cancelled'], ['success', 'skipped']];
  for (const [migration, smoke] of blockedStates) {
    expect(runSurvivor(migration, smoke).status).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe(safeCalls);
  }
  // A later docs-only survivor includes B's API change but has api=false.
  write('docs/queue.md', 'docs-only push C'); git('add', '.'); git('commit', '-qm', 'docs-only push C');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const smokeCondition = workflow.jobs.smoke.if.replaceAll('always()', 'true')
    .replaceAll('needs.changes.outputs.api', "'false'")
    .replaceAll('needs.migrate.result', "'success'");
  const smokeDecision = spawnSync('bash', ['-c', `[[ ${smokeCondition} ]]`], { cwd: root });
  expect(smokeDecision.status).toBe(0);
  expect(runSurvivor('success', 'success').stdout).toContain('verified: production branch serves group test-group');
  // A durable operator rollback hold suppresses every surviving publication.
  const beforeHold = readFileSync(log, 'utf8');
  writeFileSync(holdState, '[[{"number":99,"title":"release: iOS OTA rollback hold"}]]');
  const held = runSurvivor('success', 'success');
  expect(held.status).toBe(0);
  expect(held.stdout).toContain('OTA skipped: rollback recovery hold');
  expect(readFileSync(log, 'utf8')).toBe(beforeHold);
  // Read failure must not silently drop the hold.
  writeFileSync(holdState, 'invalid JSON');
  expect(runSurvivor('success', 'success').status).not.toBe(0);
  expect(readFileSync(log, 'utf8')).toBe(beforeHold);
  writeFileSync(holdState, '[[]]');
  git('checkout', '-q', '--detach', mobileHead);
  write('apps/mobile/app/index.tsx', 'dirty JS');
  const before = readFileSync(log, 'utf8');
  expect(run('expected.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8')).toBe(before);
  rmSync(join(root, 'apps/mobile/app/index.tsx'));
  write('new.txt', 'candidate'); git('add', '.'); git('commit', '-qm', 'unmerged candidate');
  expect(run('expected.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8')).toBe(before);
  const featureHead = git('rev-parse', 'HEAD');
  git('checkout', '-q', '--detach', apiHead);
  git('merge', '-q', '--no-ff', '--no-edit', featureHead);
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('checkout', '-q', '--detach', featureHead);
  // A feature parent is integrated by a merge but is not itself the main
  // release commit. It must not substitute for publishing that merged head.
  expect(run('expected.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8')).toBe(before);
  git('checkout', '-q', '--detach', apiHead);
  write('apps/mobile/app/index.tsx', 'approved newer mobile repair');
  git('add', '.'); git('commit', '-qm', 'mobile repair');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('checkout', '-q', '--detach', mobileHead);
  const stale = run('expected.apps.googleusercontent.com');
  expect(stale.status).toBe(1);
  expect(stale.stderr).toContain('Newer mobile inputs');
  expect(readFileSync(log, 'utf8')).toBe(before);
  // An uncertain external publication failure keeps the shared lease durable.
  git('checkout', '-q', '--detach', apiHead);
  git('update-ref', 'refs/remotes/origin/main', apiHead);
  writeFileSync(`${log}.fail`, 'network failure during EAS mutation');
  const uncertain = run('expected.apps.googleusercontent.com');
  expect(uncertain.status).not.toBe(0);
  expect(uncertain.stderr).toContain('Release lease retained');
  expect(readFileSync(leaseState, 'utf8')).toMatch(/^[a-f0-9]{40}$/);
});

test('actual rollback helper keeps a dual-platform prior group on iOS only', () => {
  copyFileSync(join(repo, 'scripts/deploy/rollback.sh'), join(root, 'scripts/deploy/rollback.sh'));
  copyFileSync(join(repo, 'scripts/deploy/ota-hold.sh'), join(root, 'scripts/deploy/ota-hold.sh'));
  copyFileSync(join(repo, 'scripts/deploy/ota-lock.sh'), join(root, 'scripts/deploy/ota-lock.sh'));
  const bin = join(root, '.git/bin'); mkdirSync(bin);
  const log = join(root, '.git/eas-calls');
  const holdState = join(root, '.git/hold-state');
  writeFileSync(holdState, '[[]]');
  const leaseState = join(root, '.git/lease-state');
  installGithubFixture(bin, holdState, leaseState);
  writeFileSync(join(bin, 'npx'), `#!/bin/bash\nset -eu\n[ -z "\${GH_TOKEN:-}" ] && [ -z "\${GITHUB_TOKEN:-}" ] || exit 88\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\nupdate:list) if [ -f '${log}.recovered' ]; then printf '{"currentPage":[{"group":"recovery-group"}]}'; exit 0; fi; printf '{"currentPage":[{"group":"current","message":"now"},{"group":"prior","message":"before","platforms":"android, ios"}]}' ;;\nupdate:republish) [ -f '${leaseState}' ]; [ "$(cat '${leaseState}')" != "$(printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" ]; touch '${log}.recovered'; printf '[{"group":"recovery-group"}]' ;;\n*) exit 99 ;;\nesac\n`, { mode: 0o755 });
  writeFileSync(leaseState, 'a'.repeat(40));
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const result = spawnSync('bash', ['scripts/deploy/rollback.sh', 'mobile', 'prior'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}` },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Waiting for active iOS release lease');
  expect(() => readFileSync(leaseState)).toThrow();
  expect(readFileSync(holdState, 'utf8')).toContain('release: iOS OTA rollback hold');
  expect(readFileSync(log, 'utf8')).toContain('update:republish --platform ios --group prior');
  // Exercise the confirmed P1 end to end: real rollback creates the hold,
  // then an unrelated integrated push reaches the real publication helper.
  copyFileSync(join(repo, 'scripts/deploy/ota.sh'), join(root, 'scripts/deploy/ota.sh'));
  write('.gitignore', '.evidence/\n');
  write('apps/api/unrelated.ts', 'API-only follow-up');
  git('add', '.'); git('commit', '-qm', 'unrelated main push after rollback');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const callsAfterRollback = readFileSync(log, 'utf8');
  const publish = spawnSync('bash', ['scripts/deploy/ota.sh', 'unrelated main push'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}` },
  });
  expect(publish.status).toBe(0);
  expect(publish.stdout).toContain('OTA skipped: rollback recovery hold');
  expect(readFileSync(log, 'utf8')).toBe(callsAfterRollback);
});

test('the native guard checks its checkout despite inherited Git hook metadata', () => {
  const result = spawnSync('node', ['scripts/deploy/native-compatibility.mjs'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, GIT_WORK_TREE: repo, GIT_INDEX_FILE: '/missing-index' },
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).source_sha).toBe(git('rev-parse', 'HEAD'));
});
