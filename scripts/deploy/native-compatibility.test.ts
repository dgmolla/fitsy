import { installGithubFixture } from './ota-test-fixtures';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const repo = resolve(__dirname, '../..');
const mobileRequire = createRequire(join(repo, 'apps/mobile/package.json'));
jest.setTimeout(120000);
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
const fixtureConfig = `export default {
  name: 'Fitsy', slug: 'fitsy', version: '1.0.0', icon: './assets/icon.png',
  scheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  ios: { bundleIdentifier: 'com.fitsy.mobile', buildNumber: '5', supportsTablet: false },
  runtimeVersion: { policy: 'appVersion' }, extra: { api: process.env.EXPO_PUBLIC_API_URL },
};\n`;
function fingerprint() {
  return JSON.parse(execFileSync('node', ['scripts/deploy/native-fingerprint.mjs'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, EXPO_NO_DOTENV: '1',
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'expected.apps.googleusercontent.com' },
  })).fingerprint;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-ota-'));
  git('init', '-q'); git('remote', 'add', 'origin', root); git('config', 'user.name', 'Fitsy test'); git('config', 'user.email', 'test@fitsy.invalid');
  write('.gitignore', 'node_modules/\n.evidence/\n');
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
  write('apps/mobile/package.json', JSON.stringify({ name: 'ota-fixture', dependencies: {
    expo: require('expo/package.json').version, 'react-native': require('react-native/package.json').version,
  } }));
  symlinkSync(join(repo, 'apps/mobile/node_modules'), join(root, 'apps/mobile/node_modules'), 'dir');
  write('package.json', JSON.stringify({ private: true, workspaces: ['apps/mobile'] }));
  write('apps/mobile/app.config.ts', fixtureConfig);
  copyFileSync(join(repo, 'apps/mobile/fingerprint.config.cjs'), join(root, 'apps/mobile/fingerprint.config.cjs'));
  write('apps/mobile/plugins/bridge.swift', 'native bridge v1');
  write('package-lock.json', '{}');
  write('apps/mobile/assets/icon.png', 'icon');
  mkdirSync(join(root, 'scripts/deploy'), { recursive: true });
  for (const file of ['native-compatibility.mjs', 'native-fingerprint.mjs', 'ota-target.mjs', 'ota-policy.json'])
    copyFileSync(join(repo, 'scripts/deploy', file), join(root, 'scripts/deploy', file));
  write('scripts/deploy/ota-policy.json', JSON.stringify({ version: 1, automatic_channel: 'production', app_store_launched: false }));
  const native = fingerprint();
  git('add', '.'); git('commit', '-qm', 'binary source');
  const source = git('rev-parse', 'HEAD');
  write('scripts/deploy/ios-production-binary-baseline.json', JSON.stringify({
    ...JSON.parse(readFileSync(join(repo, 'scripts/deploy/ios-production-binary-baseline.json'), 'utf8')),
    source_sha: source, google_ios_client_id: 'expected.apps.googleusercontent.com', fingerprint: native,
  }));
  git('add', '.'); git('commit', '-qm', 'verified baseline');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('accepts JS, styles and arbitrary bundle-only assets', () => {
  write('apps/mobile/app/index.tsx', 'new JavaScript');
  write('apps/mobile/assets/app-screenshot.png', 'bundle image');
  write('apps/mobile/assets/new-sound.wav', 'bundle sound');
  write('apps/mobile/app/styles.ts', 'new styles');
  git('add', '.'); git('commit', '-qm', 'JS release');
  const result = check(true);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ compatible: true, platform: 'ios', production_env_checked: true });
});

test.each(['apps/mobile/eas.json', 'apps/mobile/assets/icon.png', 'apps/mobile/ios/new.m',
  'patches/native.patch', 'apps/mobile/plugins/native.swift',
  'apps/mobile/.eas/build/native.sh', '.eas/build/native.sh'])('blocks committed native input %s', path => {
  write(path, 'changed native input'); git('add', '.'); git('commit', '-qm', 'native release');
  const result = check();
  expect(result.status).toBe(1); expect(result.stderr).toMatch(/[Ss]hip and verify a binary/);
});

test.each(['apps/mobile/plugins/bridge.swift', 'apps/mobile/ios/untracked.m'])('blocks dirty or untracked native input %s', path => {
  write(path, 'uncommitted native input'); expect(check().status).toBe(1);
});
test('accepts API-only dependencies and a build-time guard that leaves evaluated native config unchanged', () => {
  write('package.json', JSON.stringify({ private: true, workspaces: ['apps/mobile'], dependencies: { jose: '^6.2.2' } }));
  write('package-lock.json', JSON.stringify({ packages: { 'node_modules/jose': { version: '6.2.2' } } }));
  write('apps/mobile/app.config.ts', `if (process.env.EXPO_PUBLIC_SECRET_KEY) throw new Error('secret rejected');\n${fixtureConfig}`);
  git('add', '.'); git('commit', '-qm', 'API dependencies and publish guard');
  expect(check().status).toBe(0);
});
test('ignores runtime-only extra configuration but blocks native permissions and new native modules', () => {
  const env = { ...cleanEnv, EXPO_PUBLIC_API_URL: 'https://api.example.com', EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'expected.apps.googleusercontent.com' };
  expect(spawnSync('node', ['scripts/deploy/native-compatibility.mjs', '--production-env'], { cwd: root, env }).status).toBe(0);
  write('apps/mobile/app.config.ts', fixtureConfig.replace('supportsTablet: false', "supportsTablet: false, infoPlist: { NSCameraUsageDescription: 'Use camera' }"));
  expect(check().status).toBe(1);
  write('apps/mobile/app.config.ts', fixtureConfig);
  const pkg = JSON.parse(readFileSync(join(root, 'apps/mobile/package.json'), 'utf8'));
  pkg.dependencies['react-native-maps'] = mobileRequire('react-native-maps/package.json').version;
  write('apps/mobile/package.json', JSON.stringify(pkg));
  expect(check().status).toBe(1);
});
test('fails closed on invalid app configuration rather than accepting a partial Expo fingerprint', () => {
  write('apps/mobile/app.config.ts', "throw new Error('bad configuration');");
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('incomplete');
});
test.each([undefined, { hash: 'invalid', package_version: '0.15.4' }, { hash: '1'.repeat(40), package_version: '0.0.0' }])(
  'fails closed on missing, malformed or differently generated baseline fingerprints', native => {
    const path = join(root, 'scripts/deploy/ios-production-binary-baseline.json');
    const baseline = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...baseline, fingerprint: native }));
    expect(check().status).toBe(1);
  });
test('requires the fingerprint runtime to match the actual verified binary runtime', () => {
  write('apps/mobile/app.config.ts', fixtureConfig.replace("policy: 'appVersion'", "policy: 'fingerprint'"));
  const path = join(root, 'scripts/deploy/ios-production-binary-baseline.json');
  const baseline = JSON.parse(readFileSync(path, 'utf8'));
  const native = fingerprint();
  writeFileSync(path, JSON.stringify({ ...baseline, fingerprint: native }));
  expect(check().status).toBe(1);
  writeFileSync(path, JSON.stringify({ ...baseline, fingerprint: native, runtime_version: native.hash }));
  expect(check().status).toBe(0);
});
test('accepts a fingerprint TestFlight upload with an explicitly unknown Apple build ID', () => {
  write('apps/mobile/app.config.ts', fixtureConfig.replace("policy: 'appVersion'", "policy: 'fingerprint'"));
  const native = fingerprint();
  const baseline = JSON.parse(readFileSync(join(root, 'scripts/deploy/ios-production-binary-baseline.json'), 'utf8'));
  const path = join(root, 'scripts/deploy/ios-binary-baseline.json');
  const receipt = { ...baseline, channel: 'testflight', asc_build_id: null,
    eas_submission_id: '84491d3e-1a80-4387-a82c-6cb9f5190cef', eas_submission_status: 'FINISHED',
    fingerprint: native, runtime_version: native.hash };
  write('scripts/deploy/ota-policy.json', JSON.stringify({ version: 1, automatic_channel: 'testflight', app_store_launched: false }));
  writeFileSync(path, JSON.stringify(receipt));
  write('apps/mobile/app/index.tsx', 'a later JavaScript-only change');
  git('add', '.'); git('commit', '-qm', 'TestFlight receipt and JS update');
  const result = check(true);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ compatible: true, channel: 'testflight', runtime_version: native.hash });
  for (const invalid of [{ eas_submission_status: 'IN_PROGRESS' }, { eas_submission_id: 'unknown' },
    { asc_build_id: 'invented' }, { ipa_sha256: null }, { verified_at: null }]) {
    writeFileSync(path, JSON.stringify({ ...receipt, ...invalid }));
    expect(check().status).toBe(1);
  }
});
test('production still requires its Apple build ID and refuses a TestFlight receipt', () => {
  const path = join(root, 'scripts/deploy/ios-production-binary-baseline.json');
  const baseline = JSON.parse(readFileSync(path, 'utf8'));
  for (const invalid of [{ asc_build_id: null, eas_submission_id: '84491d3e-1a80-4387-a82c-6cb9f5190cef', eas_submission_status: 'FINISHED' },
    { channel: 'testflight' }, { build_number: '6' }]) {
    writeFileSync(path, JSON.stringify({ ...baseline, ...invalid }));
    expect(check().status).toBe(1);
  }
});
test('matches the runtime computed by the real expo-updates consumer', () => {
  write('apps/mobile/app.config.ts', fixtureConfig.replace("policy: 'appVersion'", "policy: 'fingerprint'"));
  const cli = join(mobileRequire.resolve('expo-updates/package.json'), '../bin/cli');
  const actual = JSON.parse(execFileSync('node', [cli, 'runtimeversion:resolve', '--platform', 'ios', 'apps/mobile'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, EXPO_NO_DOTENV: '1',
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'expected.apps.googleusercontent.com' },
  }));
  expect(actual.workflow).toBe('managed');
  expect(fingerprint().hash).toBe(actual.runtimeVersion);
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
  const path = join(root, 'scripts/deploy/ios-production-binary-baseline.json');
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

test.each(['production', 'testflight'])('actual %s helper prevents unsafe publication and exports only verified iOS', channel => {
  if (channel === 'testflight') {
    const baseline = JSON.parse(readFileSync(join(root, 'scripts/deploy/ios-production-binary-baseline.json'), 'utf8'));
    write('scripts/deploy/ios-binary-baseline.json', JSON.stringify({ ...baseline, channel, asc_build_id: null,
      eas_submission_id: '84491d3e-1a80-4387-a82c-6cb9f5190cef', eas_submission_status: 'FINISHED' }));
    write('scripts/deploy/ota-policy.json', JSON.stringify({ version: 1, automatic_channel: channel, app_store_launched: true }));
  }
  const appliedHead = git('rev-parse', 'HEAD');
  write('apps/mobile/app/pending.tsx', 'unapplied JavaScript');
  copyFileSync(join(repo, 'scripts/deploy/ota.sh'), join(root, 'scripts/deploy/ota.sh'));
  copyFileSync(join(repo, 'scripts/deploy/ota-hold.sh'), join(root, 'scripts/deploy/ota-hold.sh'));
  copyFileSync(join(repo, 'scripts/deploy/ota-lock.sh'), join(root, 'scripts/deploy/ota-lock.sh'));
  copyFileSync(join(repo, 'scripts/deploy/ota-bundle-identity.py'), join(root, 'scripts/deploy/ota-bundle-identity.py'));
  write('.gitignore', '.evidence/\n');
  git('add', '.'); git('commit', '-qm', 'helper');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const bin = join(root, '.git/bin'); mkdirSync(bin);
  const log = join(root, '.git/eas-calls');
  writeFileSync(log, '');
  const holdState = join(root, '.git/hold-state');
  writeFileSync(holdState, '[[]]');
  const leaseState = join(root, '.git/lease-state');
  installGithubFixture(bin, holdState, leaseState);
  writeFileSync(join(bin, 'curl'), "#!/bin/bash\nprintf '%s' '{\"runtimeVersion\":\"1.0.0\",\"launchAsset\":{\"hash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"contentType\":\"application/javascript\"},\"assets\":[],\"extra\":{}}'\n", { mode: 0o755 });
  writeFileSync(join(bin, 'npx'), `#!/bin/bash\nset -eu\n[ -z "\${GH_TOKEN:-}" ] && [ -z "\${GITHUB_TOKEN:-}" ] || exit 88\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\nchannel:view) node -e 'const channel=process.argv[1],bad=require("fs").existsSync(process.argv[2]); process.stdout.write(JSON.stringify({currentPage:{name:channel,branchMapping:JSON.stringify({version:0,data:[{branchId:channel,branchMappingLogic:"true"}]}),updateBranches:[{id:channel,name:bad?"shared":channel}]}}));' "$3" '${log}.bad-channel' ;;\nenv:exec) bash -c "$4" ;;\nupdate:view) [ "$#" -eq 4 ] && [ "$1" = eas-cli@18 ] && [ "$4" = --json ] || { printf '%s\\n' 'Unsupported update:view arguments: expected GROUP --json' >&2; exit 2; }; printf '[{"group":"%s","platform":"ios","gitCommitHash":"%s","runtimeVersion":"1.0.0","manifestPermalink":"https://u.expo.dev/update/11111111-1111-1111-1111-111111111111"}]' "$3" "$(cat '${log}.applied' 2>/dev/null || printf %s '${appliedHead}')" ;;\nupdate) [ ! -f '${log}.fail' ] || exit 7; touch '${log}.published'; printf '[{"group":"test-group"}]' ;;\nupdate:list) if [ -f '${log}.malformed' ]; then printf '{}'; elif [ -f '${log}.empty' ] && [ ! -f '${log}.published' ]; then printf '{"currentPage":[]}'; else printf '{"currentPage":[{"group":"test-group"}]}'; fi ;;\n*) exit 99 ;;\nesac\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const event = join(root, '.git/dispatch-event.json');
  writeFileSync(event, JSON.stringify({ inputs: { approve_production_ota: 'true' } }));
  const run = (google: string, manual = false) => spawnSync('bash', ['scripts/deploy/ota.sh', ...(manual ? ['--manual-production'] : []), 'test release'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`,
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: google, GH_TOKEN: 'fixture-repository-token', GITHUB_TOKEN: 'fixture-repository-token',
      GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'dgmolla',
      GITHUB_REPOSITORY: 'dgmolla/fitsy', GITHUB_SHA: git('rev-parse', 'HEAD') },
  });
  expect(run('different.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8')).not.toContain('update --platform');
  const accepted = run('expected.apps.googleusercontent.com');
  expect(accepted.status === 0 ? '' : accepted.stdout + accepted.stderr).toBe('');
  expect(accepted.status).toBe(0);
  expect(accepted.stdout).toContain(`verified: ${channel} branch serves group test-group`);
  expect(readFileSync(log, 'utf8')).toContain(`update --platform ios --branch ${channel} --environment production`);
  if (channel === 'testflight') expect(readFileSync(log, 'utf8')).not.toContain('--branch production');
  writeFileSync(`${log}.bad-channel`, 'shared channel branch');
  const publications = () => readFileSync(log, 'utf8').split('\n').filter(line => line.startsWith('eas-cli@18 update --platform')).length;
  const beforeRemapping = publications();
  const remapped = run('expected.apps.googleusercontent.com');
  expect(remapped.status).toBe(1);
  expect(remapped.stderr).toContain('Channel must point only to its own branch');
  expect(publications()).toBe(beforeRemapping);
  rmSync(`${log}.bad-channel`);
  if (channel === 'production') {
    const approved = run('expected.apps.googleusercontent.com', true);
    expect(approved.status === 0 ? '' : approved.stdout + approved.stderr).toBe('');
    expect(approved.stdout).toContain('verified: production branch serves group test-group');
  }
  // A newly created, correctly mapped TestFlight channel has no previous OTA.
  // Bootstrap from the verified embedded source, but reject malformed listings.
  writeFileSync(`${log}.empty`, 'empty channel');
  rmSync(`${log}.published`, { force: true });
  const initial = run('expected.apps.googleusercontent.com');
  expect(initial.status === 0 ? '' : initial.stdout + initial.stderr).toBe('');
  expect(initial.stdout).toContain(`verified: ${channel} branch serves group test-group`);
  rmSync(`${log}.empty`);
  writeFileSync(`${log}.malformed`, 'partial EAS response');
  const beforeMalformed = readFileSync(log, 'utf8').split('\n').filter(line => line.startsWith('eas-cli@18 update --platform')).length;
  expect(run('expected.apps.googleusercontent.com').status).toBe(1);
  expect(readFileSync(log, 'utf8').split('\n').filter(line => line.startsWith('eas-cli@18 update --platform')).length).toBe(beforeMalformed);
  rmSync(`${log}.malformed`);
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
  const queuedPublication = run('expected.apps.googleusercontent.com');
  expect(queuedPublication.status).toBe(0);
  expect(queuedPublication.stdout).toContain(`verified: ${channel} branch serves group test-group`);
  // B has no new mobile JS, so successful publication of integrated A serves
  // the current mobile contents without requiring B to retry A's missing OTA.
  // GitHub may replace pending A entirely while another Deploy is active.
  // Evaluate the actual surviving B job guard and run the actual helper: its
  // API-only source must not suppress publication of A's unapplied mobile JS.
  git('checkout', '-q', '--detach', apiHead);
  const runSurvivor = (smoke: string) => {
    const condition = workflow.jobs.ota.if.replaceAll('always()', 'true')
      .replaceAll('needs.changes.outputs.mobile', "'false'")
      .replaceAll('needs.smoke.result', `'${smoke}'`);
    return spawnSync('bash', ['-e', '-c', `if [[ ${condition} ]]; then bash scripts/deploy/ota.sh 'surviving API push'; fi`], {
      cwd: root, encoding: 'utf8', env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`,
        EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'expected.apps.googleusercontent.com' },
    });
  };
  const survivingPublication = runSurvivor('success');
  expect(survivingPublication.status).toBe(0);
  expect(survivingPublication.stdout).toContain(`"source_sha":"${apiHead}"`);
  expect(survivingPublication.stdout).toContain(`verified: ${channel} branch serves group test-group`);
  const safeCalls = readFileSync(log, 'utf8');
  const blockedStates = ['failure', 'cancelled', 'skipped'];
  for (const smoke of blockedStates) {
    expect(runSurvivor(smoke).status).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe(safeCalls);
  }
  // A later docs-only survivor includes B's API change but has api=false.
  write('docs/queue.md', 'docs-only push C'); git('add', '.'); git('commit', '-qm', 'docs-only push C');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const smokeCondition = workflow.jobs.smoke.if.replaceAll('always()', 'true')
    .replaceAll('needs.changes.outputs.api', "'false'")
    .replaceAll('needs.changes.result', "'success'");
  const smokeDecision = spawnSync('bash', ['-c', `[[ ${smokeCondition} ]]`], { cwd: root });
  expect(smokeDecision.status).toBe(0);
  expect(runSurvivor('success').stdout).toContain(`verified: ${channel} branch serves group test-group`);
  writeFileSync(`${log}.applied`, git('rev-parse', 'HEAD'));
  const alreadyApplied = runSurvivor('success');
  expect(alreadyApplied.status).toBe(0);
  expect(alreadyApplied.stdout).toContain('OTA not applicable');
  rmSync(`${log}.applied`);
  // A durable operator rollback hold suppresses every surviving publication.
  const beforeHold = readFileSync(log, 'utf8');
  writeFileSync(holdState, '[[{"number":99,"title":"release: iOS OTA rollback hold"}]]');
  const held = runSurvivor('success');
  expect(held.status).toBe(0);
  expect(held.stdout).toContain('OTA skipped: rollback recovery hold');
  expect(readFileSync(log, 'utf8')).toBe(beforeHold);
  // Read failure must not silently drop the hold.
  writeFileSync(holdState, 'invalid JSON');
  expect(runSurvivor('success').status).not.toBe(0);
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
  copyFileSync(join(repo, 'scripts/deploy/ota-bundle-identity.py'), join(root, 'scripts/deploy/ota-bundle-identity.py'));
  const bin = join(root, '.git/bin'); mkdirSync(bin);
  const log = join(root, '.git/eas-calls');
  const holdState = join(root, '.git/hold-state');
  writeFileSync(holdState, '[[]]');
  const leaseState = join(root, '.git/lease-state');
  installGithubFixture(bin, holdState, leaseState);
  writeFileSync(join(bin, 'curl'), "#!/bin/bash\nprintf '%s' '{\"runtimeVersion\":\"1.0.0\",\"launchAsset\":{\"hash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"contentType\":\"application/javascript\"},\"assets\":[],\"extra\":{}}'\n", { mode: 0o755 });
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
