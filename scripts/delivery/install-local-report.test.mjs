import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = join(dirname(fileURLToPath(import.meta.url)), 'install-local-report.sh');

test('installer accepts only a clean checkout at the current main commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-installer-'));
  try {
    const repo = join(root, 'repo'), home = join(root, 'home'), bin = join(root, 'bin');
    mkdirSync(repo); mkdirSync(bin);
    mkdirSync(join(home, 'firstmate/config'), { recursive: true });
    mkdirSync(join(root, 'bridge'));
    writeFileSync(join(root, 'bridge/bridge.py'), '');
    writeFileSync(join(home, 'firstmate/config/slack-notifications.json'),
      JSON.stringify({ bridge_path: join(root, 'bridge'), channel:'C1', user:'U1' }));
    writeFileSync(join(repo, 'tracked.txt'), 'reviewed source\n');
    mkdirSync(join(repo,'scripts/delivery'), {recursive:true});
    for (const file of ['hourly-report.mjs','phase-report.mjs','phase-events.mjs','improvements.mjs','local-report.py'])
      writeFileSync(join(repo,'scripts/delivery',file), 'fixture');
    mkdirSync(join(repo,'.evidence/delivery'), {recursive:true});
    writeFileSync(join(repo,'.evidence/delivery/binding.json'), '{}');
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      'add', '.']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      'commit', '-qm', 'fixture']);
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const gh = join(bin, 'gh');
    writeFileSync(gh, '#!/bin/sh\ncase "$*" in\n  *commits/main*) printf "%s\\n" "$TEST_MAIN_SHA";;\n  *contents/*) printf "%s\\n" "$TEST_WORKFLOW_BASE64";;\n  *) exit 2;;\nesac\n');
    chmodSync(gh, 0o755);
    const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
      TEST_MAIN_SHA: head,
      TEST_WORKFLOW_BASE64: Buffer.from('name: manual\non:\n  workflow_dispatch:\n').toString('base64') };
    const check = () => spawnSync('bash', [installer, '--check'], { cwd: repo, env, encoding: 'utf8' });
    assert.equal(check().status, 0);
    writeFileSync(join(bin,'launchctl'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin,'launchctl'),0o755);
    env.FITSY_DISPATCH_HOME = join(root,'custom-dispatcher');
    const install = spawnSync('bash',[installer,'--install','--timing-root',repo],{cwd:repo,env,encoding:'utf8'});
    assert.equal(install.status,0,install.stderr);
    const plist = readFileSync(join(home,'Library/LaunchAgents/com.fitsy.local-delivery-report.plist'),'utf8');
    assert.match(plist,new RegExp(`<key>FITSY_DISPATCHER_CONFIG</key><string>${realpathSync(root)}/custom-dispatcher/config.json</string>`));
    env.TEST_MAIN_SHA = 'f'.repeat(40);
    assert.match(check().stderr, /not the exact current main commit/);
    env.TEST_MAIN_SHA = head;
    writeFileSync(join(repo, 'tracked.txt'), 'unreviewed change\n');
    assert.match(check().stderr, /uncommitted files/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
