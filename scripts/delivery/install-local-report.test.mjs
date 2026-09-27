import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = join(dirname(fileURLToPath(import.meta.url)), 'install-local-report.sh');
const delivery = dirname(installer);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-reporter-'));
  const repo = join(root, 'repo'), home = join(root, 'home'), bin = join(root, 'bin');
  const bridge = join(root, 'bridge'), timing = join(root, 'timing');
  for (const path of [repo, bin, bridge, timing, join(home, 'firstmate/config')]) {
    mkdirSync(path, { recursive: true });
  }
  mkdirSync(join(timing, '.evidence/delivery'), { recursive: true });
  writeFileSync(join(timing, '.evidence/delivery/binding.json'), '{}\n');
  writeFileSync(join(bridge, 'bridge.py'), `
import os
import time
from pathlib import Path
def load_env(): pass
class SlackError(Exception):
    def __init__(self, retry_at):
        super().__init__('backoff')
        self.retry_at = retry_at
class Config:
    @staticmethod
    def from_env(): return Config()
    channel = 'C_REPORT'
class Store:
    def __init__(self, settings): pass
class Slack:
    def __init__(self, store): pass
    def call(self, method):
        if method == 'auth.test':
            marker = Path.home() / 'auth-next'
            now = time.time()
            if marker.exists() and float(marker.read_text()) > now:
                raise SlackError(float(marker.read_text()))
            marker.write_text(str(now + 0.15))
            return {'ok': True, 'user_id': os.environ['TEST_SENDER']}
        raise AssertionError(method)
`);
  writeFileSync(join(home, 'firstmate/config/slack-notifications.json'),
    JSON.stringify({ bridge_path: bridge, channel: 'C_REPORT', user: 'U_RECIPIENT' }));
  mkdirSync(join(repo, 'scripts/delivery'), { recursive: true });
  for (const file of ['hourly-report.mjs', 'phase-report.mjs', 'phase-events.mjs',
    'improvements.mjs', 'local-report.py']) {
    copyFileSync(join(delivery, file), join(repo, 'scripts/delivery', file));
  }
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
    'commit', '-qm', 'fixture']);
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\ncase "$*" in\n  *commits/main*) printf "%s\\n" "$TEST_MAIN_SHA";;\n  *contents/*) printf "%s\\n" "$TEST_WORKFLOW_BASE64";;\n  *) exit 2;;\nesac\n');
  writeFileSync(join(bin, 'launchctl'), `#!/bin/sh
if [ "$1" = bootstrap ]; then
  python3 - "$3" <<'PY'
import os, plistlib, subprocess, sys
from pathlib import Path
with open(sys.argv[1], 'rb') as file: plist = plistlib.load(file)
env = {**os.environ, **plist['EnvironmentVariables']}
result = subprocess.run(plist['ProgramArguments'], env=env, capture_output=True, text=True)
Path(os.environ['TEST_LAUNCH_STATUS']).write_text(str(result.returncode))
Path(os.environ['TEST_LAUNCH_LOG']).write_text(result.stdout + result.stderr)
PY
fi
`);
  for (const name of ['gh', 'launchctl']) chmodSync(join(bin, name), 0o755);
  const state = join(home, '.fitsy-delivery');
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    FITSY_DELIVERY_HOME: state, FITSY_DISPATCH_HOME: join(home, '.fitsy-dispatcher'),
    TEST_SENDER: 'U_BOT', TEST_MAIN_SHA: head,
    TEST_LAUNCH_STATUS: join(root, 'launch-status'), TEST_LAUNCH_LOG: join(root, 'launch-log'),
    TEST_WORKFLOW_BASE64: Buffer.from('name: manual\non:\n  workflow_dispatch:\n').toString('base64') };
  const install = () => spawnSync('bash', [installer, '--install', '--timing-root', timing],
    { cwd: repo, env, encoding: 'utf8' });
  return { root, repo, home, state, timing, env, install };
}

test('installer accepts only a clean checkout at the current main commit', () => {
  const { root, repo, env } = fixture();
  try {
    const check = () => spawnSync('bash', [installer, '--check'], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(check().status, 0);
    env.TEST_MAIN_SHA = 'f'.repeat(40);
    assert.match(check().stderr, /not the exact current main commit/);
    env.TEST_MAIN_SHA = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }).trim();
    writeFileSync(join(repo, 'scripts/delivery/local-report.py'), 'unreviewed change\n');
    assert.match(check().stderr, /uncommitted files/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('disposable install launches with distinct recipient and sender, then preserves state on reinstall', () => {
  const { root, state, env, install } = fixture();
  try {
    const first = install();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(readFileSync(env.TEST_LAUNCH_STATUS, 'utf8'), '0',
      readFileSync(env.TEST_LAUNCH_LOG, 'utf8'));
    const config = JSON.parse(readFileSync(join(state, 'config.json'), 'utf8'));
    assert.equal(config.user, 'U_BOT');
    assert.equal(config.recipient_user, 'U_RECIPIENT');
    const receipt = join(state, 'slots', '2026-09-27T03-30.json');
    writeFileSync(receipt, JSON.stringify({ state: 'pending', post_intent: true }) + '\n');
    const again = install();
    assert.equal(again.status, 0, again.stderr);
    assert.equal(readFileSync(env.TEST_LAUNCH_STATUS, 'utf8'), '0',
      readFileSync(env.TEST_LAUNCH_LOG, 'utf8'));
    assert.deepEqual(JSON.parse(readFileSync(join(state, 'config.json'), 'utf8')), config);
    assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')),
      { state: 'pending', post_intent: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reinstall migrates recovered sender state without changing activation, roots or receipts', () => {
  const { root, state, install } = fixture();
  try {
    assert.equal(install().status, 0);
    const configPath = join(state, 'config.json');
    const original = JSON.parse(readFileSync(configPath, 'utf8'));
    const { recipient_user: _recipient_user, ...legacy } = original;
    writeFileSync(configPath, JSON.stringify(legacy) + '\n');
    const receipt = join(state, 'slots', '2026-09-27T03-30.json');
    writeFileSync(receipt, JSON.stringify({ state: 'delivered', ts: '123.456' }) + '\n');
    const result = install();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), original);
    assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')),
      { state: 'delivered', ts: '123.456' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('upgrade corrects an empty legacy recipient state while preserving activation and roots', () => {
  const { root, state, install } = fixture();
  try {
    assert.equal(install().status, 0);
    const configPath = join(state, 'config.json');
    const original = JSON.parse(readFileSync(configPath, 'utf8'));
    const { recipient_user: _recipient_user, ...legacy } = original;
    writeFileSync(configPath, JSON.stringify({ ...legacy, user: 'U_RECIPIENT' }) + '\n');
    const result = install();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ambiguous legacy recipient state with receipts is retained for reconciliation', () => {
  const { root, state, install } = fixture();
  try {
    assert.equal(install().status, 0);
    const configPath = join(state, 'config.json');
    const original = JSON.parse(readFileSync(configPath, 'utf8'));
    const { recipient_user: _recipient_user, ...legacy } = original;
    const oldState = JSON.stringify({ ...legacy, user: 'U_RECIPIENT' }) + '\n';
    writeFileSync(configPath, oldState);
    const receipt = join(state, 'slots', '2026-09-27T03-30.json');
    writeFileSync(receipt, JSON.stringify({ state: 'delivered', ts: '123.456' }) + '\n');
    const result = install();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Slack publisher identity changed/);
    assert.equal(readFileSync(configPath, 'utf8'), oldState);
    assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')),
      { state: 'delivered', ts: '123.456' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy migration requires a stale dispatcher to be paused and uninstalled', () => {
  const { root, home, state, env, install } = fixture();
  try {
    assert.equal(install().status, 0);
    const configPath = join(state, 'config.json');
    const original = JSON.parse(readFileSync(configPath, 'utf8'));
    const { recipient_user: _recipient_user, ...legacy } = original;
    const oldState = JSON.stringify({ ...legacy, user: 'U_RECIPIENT' }) + '\n';
    writeFileSync(configPath, oldState);
    const runtime = join(state, 'runtime/local-report.py');
    writeFileSync(runtime, 'prior reviewed runtime\n');
    mkdirSync(env.FITSY_DISPATCH_HOME, { recursive: true });
    const dispatcherConfig = join(env.FITSY_DISPATCH_HOME, 'config.json');
    writeFileSync(dispatcherConfig, JSON.stringify({ enabled: true,
      slack: { sender: 'U_RECIPIENT', recipient: 'U_RECIPIENT' } }) + '\n');
    const dispatcherPlist = join(home, 'Library/LaunchAgents/com.fitsy.local-dispatcher.plist');
    mkdirSync(join(home, 'Library/LaunchAgents'), { recursive: true });
    writeFileSync(dispatcherPlist, 'fixture LaunchAgent\n');
    const refused = install();
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /pause and uninstall the stale local dispatcher/);
    assert.equal(readFileSync(configPath, 'utf8'), oldState);
    assert.equal(readFileSync(runtime, 'utf8'), 'prior reviewed runtime\n');
    writeFileSync(dispatcherConfig, JSON.stringify({ enabled: false,
      slack: { sender: 'U_RECIPIENT', recipient: 'U_RECIPIENT' } }) + '\n');
    assert.match(install().stderr, /pause and uninstall the stale local dispatcher/);
    rmSync(dispatcherPlist);
    const migrated = install();
    assert.equal(migrated.status, 0, migrated.stderr);
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('token sender drift refuses reinstall and runtime launch without changing existing receipts', () => {
  const { root, state, env, install } = fixture();
  try {
    assert.equal(install().status, 0);
    const configPath = join(state, 'config.json');
    const before = readFileSync(configPath, 'utf8');
    const runtime = join(state, 'runtime/local-report.py');
    writeFileSync(runtime, 'prior reviewed runtime\n');
    const receipt = join(state, 'slots', '2026-09-27T03-30.json');
    writeFileSync(receipt, JSON.stringify({ state: 'pending', post_intent: true }) + '\n');
    env.TEST_SENDER = 'U_OTHER_BOT';
    const result = install();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Slack publisher identity changed/);
    assert.equal(readFileSync(configPath, 'utf8'), before);
    assert.equal(readFileSync(runtime, 'utf8'), 'prior reviewed runtime\n');
    assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')),
      { state: 'pending', post_intent: true });
    copyFileSync(join(delivery, 'local-report.py'), runtime);
    const launched = spawnSync('python3', [join(state, 'runtime/local-report.py')],
      { env: { ...env, FITSY_DELIVERY_STATE: state }, encoding: 'utf8' });
    assert.notEqual(launched.status, 0);
    assert.match(launched.stderr, /Slack token user does not match configured publisher/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reinstall refuses changed timing roots and the channel guard rejects shared configuration drift', () => {
  const { root, repo, home, state, env, timing, install } = fixture();
  try {
    assert.equal(install().status, 0);
    const configPath = join(state, 'config.json');
    const before = readFileSync(configPath, 'utf8');
    const other = join(root, 'other-timing');
    mkdirSync(join(other, '.evidence/delivery'), { recursive: true });
    writeFileSync(join(other, '.evidence/delivery/binding.json'), '{}\n');
    const changedRoots = spawnSync('bash', [installer, '--install', '--timing-root', other],
      { cwd: repo, env, encoding: 'utf8' });
    assert.notEqual(changedRoots.status, 0);
    assert.match(changedRoots.stderr, /timing roots changed/);
    assert.equal(readFileSync(configPath, 'utf8'), before);
    const sourcePath = join(home, 'firstmate/config/slack-notifications.json');
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
    writeFileSync(sourcePath, JSON.stringify({ ...source, channel: 'C_OTHER' }));
    const changedChannel = spawnSync('bash', [installer, '--install', '--timing-root', timing],
      { cwd: repo, env, encoding: 'utf8' });
    assert.notEqual(changedChannel.status, 0);
    assert.match(changedChannel.stderr, /Slack channel does not match shared limiter configuration/);
    assert.equal(readFileSync(configPath, 'utf8'), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
