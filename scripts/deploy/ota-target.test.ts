import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let root: string;
function policy(automatic_channel = 'production', app_store_launched = false) {
  writeFileSync(join(root, 'scripts/deploy/ota-policy.json'), JSON.stringify({ version: 1, automatic_channel, app_store_launched }));
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-ota-target-'));
  mkdirSync(join(root, 'scripts/deploy'), { recursive: true });
  mkdirSync(join(root, 'apps/mobile'), { recursive: true });
  for (const file of ['ota-target.mjs', 'ota.sh'])
    copyFileSync(resolve(__dirname, file), join(root, 'scripts/deploy', file));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/gh'), '#!/bin/bash\ntouch "$OTA_TEST_MUTATION"\nexit 99\n', { mode: 0o755 });
  writeFileSync(join(root, 'event.json'), JSON.stringify({ inputs: { approve_production_ota: 'true' } }));
  policy();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(args: string[] = [], extra: Record<string, string> = {}, publish = false) {
  return spawnSync(publish ? 'bash' : 'node', [publish ? 'scripts/deploy/ota.sh' : 'scripts/deploy/ota-target.mjs', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: join(root, 'event.json'),
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: 'dgmolla', GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'dgmolla/fitsy',
      OTA_TEST_MUTATION: join(root, 'mutated'), PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...extra },
  });
}
test('preserves the prelaunch production route and selects the separate TestFlight receipt at cutover', () => {
  expect(JSON.parse(run().stdout)).toEqual({ channel: 'production', baseline_file: 'scripts/deploy/ios-binary-baseline.json' });
  policy('testflight', true);
  expect(JSON.parse(run().stdout)).toEqual({ channel: 'testflight', baseline_file: 'scripts/deploy/ios-testflight-binary-baseline.json' });
});
test.each(['production', 'preview', 'arbitrary;command'])('rejects App Store automatic channel %s before publication', channel => {
  policy(channel, true);
  expect(run([], {}, true).status).toBe(1);
  expect(existsSync(join(root, 'mutated'))).toBe(false);
});
test('allows production only with explicit Dawit dispatch when automatic updates target TestFlight', () => {
  policy('testflight', true);
  expect(JSON.parse(run(['--manual-production']).stdout).channel).toBe('production');
  for (const extra of [{ GITHUB_ACTOR: 'other' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'other/repo' }]) {
    expect(run(['--manual-production'], extra, true).status).toBe(1);
    expect(existsSync(join(root, 'mutated'))).toBe(false);
  }
  writeFileSync(join(root, 'event.json'), JSON.stringify({ inputs: { approve_production_ota: 'false' } }));
  expect(run(['--manual-production'], {}, true).status).toBe(1);
  expect(existsSync(join(root, 'mutated'))).toBe(false);
});
test('refuses a source different from the approved dispatch before acquiring a publication lease', () => {
  writeFileSync(join(root, 'bin/git'), `#!/bin/bash\nprintf '%s\\n' '${'a'.repeat(40)}'\n`, { mode: 0o755 });
  const result = run(['--manual-production'], { GITHUB_SHA: 'b'.repeat(40) }, true);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('source differs from Dawit');
  expect(existsSync(join(root, 'mutated'))).toBe(false);
});
test('the existing TestFlight build entrypoint uses a store profile, production env and separate channel', () => {
  const eas = JSON.parse(readFileSync(resolve(__dirname, '../../apps/mobile/eas.json'), 'utf8'));
  expect(eas.build.testflight).toMatchObject({ extends: 'production', distribution: 'store', environment: 'production', channel: 'testflight' });
  expect(eas.build.production.channel).toBe('production');
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/eas-build.yml'), 'utf8');
  expect(workflow).toContain('eas build --platform ios --profile testflight --non-interactive');
  expect(workflow).toContain('environment: production-native');
});
