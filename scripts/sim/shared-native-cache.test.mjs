import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appTreeHash, importNativeArtifact, importedArtifactIntact, nativeArtifactKey, publishNativeArtifact, sharedNativeCacheDirectory } from './shared-native-cache.mjs';
import { identityHash, nativeBuildDecision, nativeIdentity, profileIdentity, sealReceipt } from './native-identity.mjs';
import { recipeIdentity } from './product-flow.mjs';
import { digest, inputHash } from '../verify/product-flow.mjs';
import { buildProfile } from './build-profile.mjs';

const cli = fileURLToPath(new URL('./product-flow.mjs', import.meta.url));
const udid = 'A9981463-2A6A-4C69-98D6-D14643C4E2D4';
const os = 'com.apple.CoreSimulator.SimRuntime.iOS-17-5';
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|GITHUB_|FITSY_|EXPO_|NODE_ENV$|CI$)/.test(key)));
const publicEnv = { EXPO_PUBLIC_API_URL: 'https://dev.fitsy.org', EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture-public', EXPO_PUBLIC_REVENUECAT_TEST_KEY: 'test_fixture',
  EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'cache-fixture@example.test' };
function write(file, content, mode) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, mode ? { mode } : undefined);
}
function writable(directory) {
  if (!existsSync(directory)) return;
  chmodSync(directory, 0o700);
  for (const name of readdirSync(directory)) {
    const path = join(directory, name), stat = lstatSync(path);
    if (stat.isDirectory()) writable(path);
    else if (!stat.isSymbolicLink()) chmodSync(path, stat.mode | 0o200);
  }
}
function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), 'fitsy-shared-native-'));
  t.after(() => { writable(temp); rmSync(temp, { recursive: true, force: true }); });
  const root = join(temp, 'first'), other = join(temp, 'second'), bin = join(temp, 'bin');
  const git = (...args) => execFileSync('git', args, { cwd: root, env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  write(join(root, '.gitignore'), 'node_modules/\n.evidence/\napps/mobile/ios/\n');
  write(join(root, 'apps/mobile/app/screen.js'), 'source-one');
  write(join(root, 'apps/mobile/native-config.json'), JSON.stringify({ name: 'Fitsy', slug: 'fitsy', ios: { bundleIdentifier: 'com.fitsy.mobile' } }));
  write(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/expo': { version: '54.0.0', integrity: 'sha512-expo' },
    'node_modules/react-native': { version: '0.81.5' }, 'node_modules/js-only': { version: '1.0.0' } } }));
  git('init', '-q'); git('config', 'user.name', 'Native cache fixture'); git('config', 'user.email', 'fixture@example.test');
  git('config', 'core.hooksPath', '/dev/null'); git('add', '.'); git('commit', '-qm', 'fixture');
  git('worktree', 'add', '--detach', other, 'HEAD');
  const executable = (name, source) => write(join(bin, name), `#!${process.execPath}\n${source}\n`, 0o700);
  executable('xcrun', `if(process.argv.includes('--sdk')) console.log('17.5');
    else console.log(JSON.stringify({devices:{${JSON.stringify(os)}:[{udid:${JSON.stringify(udid)},state:'Booted'}]}}));`);
  executable('xcodebuild', `if(process.argv.includes('-version')) console.log('Xcode fixture 15.4'); else process.exit(91);`);
  executable('xcode-select', "console.log('/Applications/Xcode-fixture.app/Contents/Developer');");
  executable('pod', "if(process.argv.includes('--version')) console.log('1.16.2'); else process.exit(92);");
  for (const directory of [root, other]) {
    // Only the external Expo/Xcode boundaries are substitutes. The actual Git,
    // native identity, artifact storage and public build caller execute below.
    write(join(directory, 'node_modules/expo/bin/cli'), `const fs=require('fs');
      if(process.argv.includes('config')) console.log(fs.readFileSync('native-config.json','utf8'));
      else { if(process.env.FITSY_METRO_FIXTURE_LOADED) fs.writeFileSync(process.env.FITSY_METRO_FIXTURE_LOADED,
        JSON.stringify({pid:process.pid,source:fs.readFileSync('app/screen.js','utf8')}));
        console.log('fixture Metro started'); setInterval(()=>{},1000); }`);
    write(join(directory, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking'),
      "console.log(JSON.stringify(process.argv.includes('resolve')?{modules:[]}:{dependencies:{}}));");
  }
  const env = { ...cleanEnv, ...publicEnv, PATH: `${bin}:${process.env.PATH}`, NODE_ENV: 'development' };
  const execute = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8' }).trim();
  const profile = profileIdentity(buildProfile(true, env), { os }, env, execute), recipe = recipeIdentity();
  // The original builder attested a generated project absent in a fresh worktree.
  write(join(root, 'apps/mobile/ios/Generated.swift'), 'native compile source');
  const native = nativeIdentity(root, env, execute), buildDir = join(root, '.evidence/product-build');
  const app = join(buildDir, 'Build/Products/Debug-iphonesimulator/Fitsy.app');
  write(join(app, 'main.jsbundle'), 'original embedded bundle');
  write(join(app, 'Fitsy'), 'native executable', 0o700);
  const receipt = sealReceipt({ backend: publicEnv.EXPO_PUBLIC_API_URL, configHash: 'original-public-config',
    nativeIdentity: native, profileIdentity: profile, recipeIdentity: recipe, buildRecipeHash: recipe.hash,
    ...buildProfile(true, env), app, appHash: appTreeHash(app), bundleHash: digest(readFileSync(join(app, 'main.jsbundle'))),
    jsHash: inputHash(root, 'js'), simulator: udid, os, metroRoute: '/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false',
    simulatorApplicationIdentifier: 'fixture.com.fitsy.mobile', builtAt: '2026-10-25T00:00:00.000Z' });
  const receiptFile = join(buildDir, 'receipt.json');
  write(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
  const cache = sharedNativeCacheDirectory(root, env), localBuild = join(other, '.evidence/product-build');
  const currentNative = () => nativeIdentity(other, env, execute);
  const invoke = (extra = {}, flags = []) => spawnSync(process.execPath, [cli, 'build', udid, '--test-store', ...flags],
    { cwd: other, encoding: 'utf8', timeout: 15_000, env: { ...env, FITSY_PRODUCT_ROOT: other, ...extra } });
  return { temp, root, other, bin, env, native, profile, recipe, receipt, receiptFile, cache, localBuild, currentNative, invoke };
}

test('public build imports across real worktrees after JS-only edits, preserving original provenance', t => {
  const f = fixture(t), before = readFileSync(f.receiptFile);
  const miss = f.invoke();
  assert.equal(miss.status, 1);
  assert.match(miss.stdout, /"action":"rebuild"/);
  assert.match(miss.stderr, /Set FITSY_SIM_OWNER/);
  assert.equal(sharedNativeCacheDirectory(f.other, f.env), f.cache);
  const published = publishNativeArtifact(f.cache, f.receiptFile);
  write(join(f.other, 'apps/mobile/app/screen.js'), 'source-two, changed JavaScript');
  const child = f.invoke();
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /verified shared native artifact/);
  const imported = JSON.parse(readFileSync(join(f.localBuild, 'receipt.json')));
  assert.equal(imported.appHash, f.receipt.appHash);
  assert.equal(imported.jsHash, f.receipt.jsHash, 'original build source cannot be relabeled');
  assert.equal(importedArtifactIntact(imported, f.localBuild), true);
  assert.deepEqual(readFileSync(f.receiptFile), before);
  const original = join(f.cache, published.key, published.artifact, 'original-receipt.json');
  assert.deepEqual(readFileSync(original), before);
  assert.deepEqual(readFileSync(join(dirname(imported.app), 'original-receipt.json')), before);
  assert.equal(lstatSync(original).mode & 0o222, 0);
  assert.equal(lstatSync(join(imported.app, 'Fitsy')).mode & 0o222, 0);
  assert.notEqual(lstatSync(join(imported.app, 'Fitsy')).ino, lstatSync(join(f.receipt.app, 'Fitsy')).ino);
  assert.equal(existsSync(join(f.localBuild, 'metro.json')), false, 'build leaves Metro startup to run');
  const repeat = f.invoke();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /verified compatible native artifact/);
});

test('native, generated configuration, recipe, SDK, toolchain, architecture and profile drift miss the cache', t => {
  const f = fixture(t); publishNativeArtifact(f.cache, f.receiptFile);
  const native = f.currentNative();
  const reseal = (identity, change) => { const inputs = { ...identity.inputs, ...change }; return { inputs, hash: identityHash(inputs) }; };
  for (const [label, n, p, r] of [
    ['permission', reseal(native, { nativeConfig: { ios: { infoPlist: { permission: 'changed' } } } }), f.profile, f.recipe],
    ['native dependency', reseal(native, { nativePackages: { expo: { integrity: 'changed' } } }), f.profile, f.recipe],
    ...['sdk', 'sdkBuild', 'xcode', 'developerDirectory', 'cocoapods', 'node', 'architecture', 'configuration', 'metroPort', 'os']
      .map(key => [key, native, reseal(f.profile, { [key]: 'changed' }), f.recipe]),
    ['recipe', native, f.profile, reseal(f.recipe, { compileNative: 'changed' })],
  ]) assert.equal(importNativeArtifact(f.cache, f.localBuild, n, p, r), null, label);
  write(join(f.other, 'apps/mobile/ios/Generated.swift'), 'manual native edit');
  assert.equal(importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe), null);
  const drift = f.invoke();
  assert.equal(drift.status, 1);
  assert.match(drift.stdout, /"action":"rebuild"/);
  assert.match(drift.stderr, /Set FITSY_SIM_OWNER/);
});

test('JS-only lock edits preserve the key; native package integrity changes invalidate it', t => {
  const f = fixture(t), file = join(f.other, 'package-lock.json'), lock = JSON.parse(readFileSync(file));
  const key = nativeArtifactKey(f.currentNative(), f.profile, f.recipe);
  lock.packages['node_modules/js-only'].version = '2.0.0'; write(file, JSON.stringify(lock));
  assert.equal(nativeArtifactKey(f.currentNative(), f.profile, f.recipe), key);
  lock.packages['node_modules/expo'].integrity = 'changed bytes, same version'; write(file, JSON.stringify(lock));
  assert.notEqual(nativeArtifactKey(f.currentNative(), f.profile, f.recipe), key);
  lock.packages['node_modules/expo'].integrity = 'sha512-expo';
  lock.packages['apps/mobile/node_modules/expo'] = lock.packages['node_modules/expo'];
  delete lock.packages['node_modules/expo']; write(file, JSON.stringify(lock));
  const nestedKey = nativeArtifactKey(f.currentNative(), f.profile, f.recipe);
  lock.packages['apps/mobile/node_modules/expo'].integrity = 'changed nested package'; write(file, JSON.stringify(lock));
  assert.notEqual(nativeArtifactKey(f.currentNative(), f.profile, f.recipe), nestedKey);
  const beforeCodegen = nativeArtifactKey(f.currentNative(), f.profile, f.recipe);
  lock.packages['node_modules/@react-native/codegen'] = { version: 'new native code generator' }; write(file, JSON.stringify(lock));
  assert.notEqual(nativeArtifactKey(f.currentNative(), f.profile, f.recipe), beforeCodegen);
});

test('native plugin source changes invalidate reuse even when introspected configuration is unchanged', t => {
  const f = fixture(t), before = nativeArtifactKey(f.currentNative(), f.profile, f.recipe);
  write(join(f.other, 'apps/mobile/plugins/native-mod.js'), 'module.exports = native => native;');
  assert.notEqual(nativeArtifactKey(f.currentNative(), f.profile, f.recipe), before);
});

test('unreadable optional cache storage falls back to the guarded real-build path', t => {
  const f = fixture(t), published = publishNativeArtifact(f.cache, f.receiptFile);
  chmodSync(join(f.cache, published.key), 0o000);
  const result = f.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"action":"rebuild"/);
  assert.match(result.stderr, /Set FITSY_SIM_OWNER/);
});

test('cache import admission fails before copying when capacity is unavailable', t => {
  const f = fixture(t); publishNativeArtifact(f.cache, f.receiptFile);
  assert.throws(() => importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe, [], () => false,
    () => { throw new Error('Native cache import needs disk capacity'); }), /disk capacity/);
  assert.equal(existsSync(f.localBuild), false);
});

test('public build rejects native configuration drift after importing an app', t => {
  const f = fixture(t); publishNativeArtifact(f.cache, f.receiptFile);
  assert.equal(f.invoke().status, 0);
  write(join(f.other, 'apps/mobile/native-config.json'), JSON.stringify({ name: 'Fitsy', slug: 'fitsy',
    ios: { bundleIdentifier: 'com.fitsy.mobile', infoPlist: { NSLocationWhenInUseUsageDescription: 'changed permission' } } }));
  const result = f.invoke();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /native input changed: nativeConfig.ios.infoPlist/);
  assert.match(result.stderr, /Set FITSY_SIM_OWNER/);
});

for (const target of ['Fitsy.app/Fitsy', 'original-receipt.json', 'manifest.json']) {
  test(`corrupt cached ${target} is a miss and is never overwritten`, t => {
    const f = fixture(t), published = publishNativeArtifact(f.cache, f.receiptFile);
    const directory = join(f.cache, published.key, published.artifact), file = join(directory, target);
    chmodSync(file, 0o600); writeFileSync(file, 'tampered');
    assert.equal(importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe), null);
    assert.throws(() => publishNativeArtifact(f.cache, f.receiptFile), /corrupt/);
    assert.equal(readFileSync(file, 'utf8'), 'tampered');
  });
}

test('executable flags and read-only permissions are verified alongside app bytes', t => {
  const f = fixture(t), published = publishNativeArtifact(f.cache, f.receiptFile);
  const executable = join(f.cache, published.key, published.artifact, 'Fitsy.app/Fitsy');
  chmodSync(executable, 0o400);
  assert.equal(importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe), null);
  chmodSync(executable, 0o500);
  assert.ok(importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe));
  chmodSync(executable, 0o700);
  assert.equal(importNativeArtifact(f.cache, join(f.temp, 'third-build'), f.currentNative(), f.profile, f.recipe), null);
});

test('imported app tampering and original receipt replacement cannot pass local reuse', t => {
  const f = fixture(t); publishNativeArtifact(f.cache, f.receiptFile);
  const imported = importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe);
  assert.equal(importedArtifactIntact(imported, f.localBuild), true);
  assert.equal(importedArtifactIntact(sealReceipt({ ...imported, jsHash: 'relabeled current source' }), f.localBuild), false);
  const localReceipt = join(f.localBuild, 'receipt.json');
  write(localReceipt, JSON.stringify(imported));
  assert.throws(() => publishNativeArtifact(f.cache, localReceipt), /invalid or imported/);
  const original = join(dirname(imported.app), 'original-receipt.json');
  chmodSync(original, 0o600); writeFileSync(original, '{}');
  assert.equal(importedArtifactIntact(imported, f.localBuild), false);
  assert.equal(importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe), null);
});

test('linked cache roots and metadata cannot redirect cache reads or writes', t => {
  const f = fixture(t), published = publishNativeArtifact(f.cache, f.receiptFile), link = join(f.temp, 'linked-cache');
  symlinkSync(f.cache, link);
  assert.equal(importNativeArtifact(link, f.localBuild, f.currentNative(), f.profile, f.recipe), null);
  assert.throws(() => publishNativeArtifact(link, f.receiptFile), /regular directory/);
  const directory = join(f.cache, published.key, published.artifact);
  chmodSync(directory, 0o700); rmSync(join(directory, 'original-receipt.json'));
  symlinkSync(f.receiptFile, join(directory, 'original-receipt.json'));
  assert.equal(importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe), null);
});

test('simultaneous publishers install one complete artifact without changing original receipts', async t => {
  const f = fixture(t), module = new URL('./shared-native-cache.mjs', import.meta.url).href;
  const publish = () => new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      `import {publishNativeArtifact} from ${JSON.stringify(module)};
       publishNativeArtifact(${JSON.stringify(f.cache)},${JSON.stringify(f.receiptFile)});`],
    { env: cleanEnv, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolveChild() : reject(new Error(stderr)));
  });
  const results = await Promise.allSettled([publish(), publish()]);
  for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
  const key = nativeArtifactKey(f.native, f.profile, f.recipe);
  assert.equal(readdirSync(join(f.cache, key)).length, 1);
  assert.ok(importNativeArtifact(f.cache, f.localBuild, f.currentNative(), f.profile, f.recipe));
});

test('each Metro startup owns a new process and serves current source without relabeling the binary', t => {
  const f = fixture(t), adapter = join(f.temp, 'network-boundary.mjs'), loaded = join(f.temp, 'loaded.json');
  const originalReceipt = readFileSync(f.receiptFile);
  // The sandbox denies sockets and ps. Substitute only those OS/HTTP boundaries;
  // exercise the real Metro spawn, source hashes, stop and restart lifecycle.
  write(adapter, `import net from 'node:net'; import {EventEmitter} from 'node:events';
    import {syncBuiltinESMExports} from 'node:module'; import {readFileSync} from 'node:fs';
    net.createServer=()=>{const server=new EventEmitter(); server.close=done=>done();
      server.listen=(port,host,done)=>{if(process.env.FITSY_METRO_FIXTURE_BUSY) {
        const error=new Error('busy port'); error.code='EADDRINUSE'; server.emit('error',error);
      } else done();}; return server;}; syncBuiltinESMExports();
    globalThis.fetch=async url=>{const loaded=JSON.parse(readFileSync(process.env.FITSY_METRO_FIXTURE_LOADED));
      process.kill(loaded.pid,0); return new Response(url.endsWith('/status')?'packager-status:running':loaded.source);};`);
  write(join(f.bin, 'ps'), `#!${process.execPath}\ntry {const pid=Number(process.argv[process.argv.indexOf('-p')+1]);
    process.kill(pid,0); console.log('fixture-process-'+pid);}catch{process.exit(1);}\n`, 0o700);
  mkdirSync(f.localBuild, { recursive: true });
  const result = spawnSync(process.execPath, ['--import', adapter, '--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import {writeFileSync,readFileSync} from 'node:fs';
    import {startMetro,stopMetro} from ${JSON.stringify(new URL('./product-flow.mjs', import.meta.url).href)};
    import {digest} from ${JSON.stringify(new URL('../verify/product-flow.mjs', import.meta.url).href)};
    try {
      const first=await startMetro({metroPort:8099});
      writeFileSync(${JSON.stringify(join(f.other, 'apps/mobile/app/screen.js'))},'new source served by second process');
      const second=await startMetro({metroPort:8099});
      assert.notEqual(first.pid,second.pid); assert.notEqual(first.jsHash,second.jsHash);
      assert.notEqual(first.bundleHash,second.bundleHash);
      assert.equal(second.bundleHash,digest('new source served by second process'));
      assert.throws(()=>process.kill(first.pid,0));
      await stopMetro(); assert.throws(()=>process.kill(second.pid,0));
      process.env.FITSY_METRO_FIXTURE_BUSY='1';
      await assert.rejects(startMetro({metroPort:8099}),{code:'EADDRINUSE'});
    } finally { await stopMetro(); }
  `], { cwd: f.other, encoding: 'utf8', timeout: 15_000,
    env: { ...f.env, FITSY_PRODUCT_ROOT: f.other, FITSY_METRO_FIXTURE_LOADED: loaded } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(f.localBuild, 'metro.json')), false);
  assert.deepEqual(readFileSync(f.receiptFile), originalReceipt);
});

test('publish is idempotent, append-only and rejects forged or symlinked source artifacts', t => {
  const f = fixture(t), first = publishNativeArtifact(f.cache, f.receiptFile);
  assert.deepEqual(publishNativeArtifact(f.cache, f.receiptFile), first);
  writeFileSync(f.receiptFile, JSON.stringify({ ...f.receipt, appHash: 'forged' }));
  assert.throws(() => publishNativeArtifact(f.cache, f.receiptFile), /invalid/);
  writeFileSync(f.receiptFile, JSON.stringify(f.receipt));
  symlinkSync(join(f.temp, 'outside'), join(f.receipt.app, 'borrowed'));
  assert.throws(() => publishNativeArtifact(f.cache, f.receiptFile), /linked/);
  assert.equal(readdirSync(join(f.cache, first.key)).length, 1);
});

test('Release remains outside the shared Metro cache and explicit force/off bypass reuse', t => {
  const f = fixture(t); publishNativeArtifact(f.cache, f.receiptFile);
  const inputs = { ...f.profile.inputs, buildMode: 'embedded-release', configuration: 'Release' };
  assert.equal(nativeArtifactKey(f.native, { inputs, hash: identityHash(inputs) }, f.recipe), null);
  for (const result of [f.invoke({ FITSY_NATIVE_CACHE_DIR: 'off' }), f.invoke({}, ['--force-rebuild', '--reason=cache diagnostic'])]) {
    assert.equal(result.status, 1); assert.match(result.stdout, /"action":"rebuild"/);
  }
  assert.throws(() => sharedNativeCacheDirectory(f.root, { ...f.env, FITSY_NATIVE_CACHE_DIR: '../relative' }), /absolute/);
  assert.deepEqual(sealReceipt(f.receipt), f.receipt);
  assert.equal(nativeBuildDecision({ receipt: f.receipt, native: f.native, profile: f.profile, recipe: f.recipe, appIntact: true }).rebuild, false);
});
