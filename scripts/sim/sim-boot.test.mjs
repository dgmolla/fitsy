import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const simPath = join(dirname(fileURLToPath(import.meta.url)), 'sim');
const udid = '11111111-1111-1111-1111-111111111111';

test('boot pre-dismisses the iOS slide-to-type sheet on a fresh boot and on every reused-device call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-sim-boot-'));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), calls = join(dir, 'calls'), booted = join(dir, 'booted-marker');
  mkdirSync(join(home, 'fitsy-wt'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  try {
    const xcrun = `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(['xcrun', ...args]) + '\\n');
if (args[0] === 'simctl' && args[1] === 'list' && args[3] === 'booted' && fs.existsSync(${JSON.stringify(booted)}))
  console.log('    iPhone 16 (${udid}) (Booted)');
if (args[0] === 'simctl' && args[1] === 'list' && args[3] === 'available')
  console.log('    iPhone 16 (${udid}) (Shutdown)');
if (args[0] === 'simctl' && args[1] === 'boot') fs.writeFileSync(${JSON.stringify(booted)}, '1');
`;
    const open = `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(['open', ...process.argv.slice(2)]) + '\\n');
`;
    writeFileSync(join(bin, 'xcrun'), xcrun, { mode: 0o755 });
    writeFileSync(join(bin, 'open'), open, { mode: 0o755 });
    const boot = () => spawnSync('bash', [simPath, 'boot'], {
      encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: home },
    });

    const first = boot();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).udid, udid);

    const second = boot();
    assert.equal(second.status, 0, second.stderr);

    const log = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const defaultsWrite = ['xcrun', 'simctl', 'spawn', udid, 'defaults', 'write',
      'com.apple.keyboard.preferences', 'DidShowContinuousPathIntroduction', '-bool', 'true'];
    const defaultsWriteCalls = log.filter(call => JSON.stringify(call) === JSON.stringify(defaultsWrite));
    // Written once per boot call, including the reused-device (already-booted) call.
    assert.equal(defaultsWriteCalls.length, 2, JSON.stringify(log));
    assert.equal(log.filter(call => call.join(' ') === `xcrun simctl boot ${udid}`).length, 1,
      'the already-booted second call must not reboot the device');
    assert.equal(log.filter(call => call[0] === 'open').length, 1, 'the already-booted second call must not relaunch the Simulator app');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
