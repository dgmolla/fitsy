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
    const waits = log.filter(call => call.join(' ') === `xcrun simctl bootstatus ${udid} -b`);
    assert.equal(waits.length, 2, 'a fresh boot and a reused device both wait for boot readiness');
    assert.ok(log.indexOf(waits[0]) < log.findIndex(call => call.includes('defaults')), 'readiness is awaited before any simctl spawn');
    assert.equal(log.filter(call => call[0] === 'open').length, 1, 'the already-booted second call must not relaunch the Simulator app');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A stand-in xcrun whose `bootstatus` outcome per attempt is scripted: 'ok', 'fail' or 'hang'.
function bootHarness(t, outcomes, { preBooted = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-sim-boot-retry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), calls = join(dir, 'calls'), booted = join(dir, 'booted'), count = join(dir, 'count');
  mkdirSync(join(home, 'fitsy-wt'), { recursive: true }); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'xcrun'), `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
const sub = args[1];
if (sub === 'list' && args[3] === 'booted' && fs.existsSync(${JSON.stringify(booted)})) console.log('    iPhone 16 (${udid}) (Booted)');
if (sub === 'list' && args[3] === 'available') console.log('    iPhone 16 (${udid}) (Shutdown)');
if (sub === 'boot') fs.writeFileSync(${JSON.stringify(booted)}, '1');
if (sub === 'shutdown') fs.rmSync(${JSON.stringify(booted)}, { force: true });
if (sub === 'bootstatus') {
  const n = fs.existsSync(${JSON.stringify(count)}) ? Number(fs.readFileSync(${JSON.stringify(count)}, 'utf8')) : 0;
  fs.writeFileSync(${JSON.stringify(count)}, String(n + 1));
  const outcome = ${JSON.stringify(outcomes)}[Math.min(n, ${JSON.stringify(outcomes)}.length - 1)];
  if (outcome === 'fail') process.exit(1);
  if (outcome === 'hang') setInterval(() => {}, 1000);
  else process.exit(0);
}
`, { mode: 0o755 });
  writeFileSync(join(bin, 'open'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  if (preBooted) writeFileSync(booted, '1');
  const boot = extra => spawnSync('bash', [simPath, 'boot'], { encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FITSY_SIM_BOOT_WAIT_SECONDS: '2', ...extra } });
  const log = () => readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)).map(call => call.join(' '));
  return { boot, log };
}

test('a failed bootstatus shuts the device down and retries the boot, then succeeds', t => {
  const { boot, log } = bootHarness(t, ['fail', 'ok']);
  const result = boot();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(JSON.parse(result.stdout).status, 'pass');
  const calls = log();
  assert.equal(calls.filter(call => call === `simctl boot ${udid}`).length, 2);
  assert.equal(calls.filter(call => call === `simctl shutdown ${udid}`).length, 1);
  assert.equal(calls.filter(call => call === `simctl bootstatus ${udid} -b`).length, 2);
});

test('a hung boot is killed after the bounded wait and a later attempt can still succeed', t => {
  const { boot, log } = bootHarness(t, ['hang', 'ok']);
  const started = Date.now();
  const result = boot();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(Date.now() - started < 20_000, 'the hang is bounded, not waited out');
  assert.equal(log().filter(call => call === `simctl boot ${udid}`).length, 2);
});

test('exhausted boot attempts fail clearly instead of continuing against an unready simulator', t => {
  const { boot, log } = bootHarness(t, ['fail']);
  const result = boot({ FITSY_SIM_BOOT_ATTEMPTS: '2' });
  assert.equal(result.status, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, 'fail');
  assert.match(out.summary, /did not finish booting after 2 attempts/);
  assert.equal(log().filter(call => call === `simctl boot ${udid}`).length, 2);
  assert.equal(log().some(call => call.includes('defaults write')), false, 'no keyboard defaults are written to an unready device');
});

test('an already-booted device that never becomes ready fails and is not shut down or rebooted', t => {
  const { boot, log } = bootHarness(t, ['hang'], { preBooted: true });
  const result = boot({ FITSY_SIM_BOOT_WAIT_SECONDS: '1' });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).summary, /did not become ready within 1s/);
  const calls = log();
  assert.equal(calls.some(call => call.startsWith('simctl shutdown') || call.startsWith('simctl boot ')), false, calls.join('\n'));
  assert.equal(calls.some(call => call.includes('defaults write')), false);
});
