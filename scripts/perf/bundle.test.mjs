import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { bundleEnvironment, checkBundle, measureBundle } from './bundle.mjs';
import { checkPerformance } from './check.mjs';

test('size checks use a deterministic keyless environment without changing the parent environment', () => {
  const parent = { EXPO_PUBLIC_API_URL: 'https://example.test', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-key',
    NODE_ENV: 'development', PATH: '/fixture/path', XDG_CACHE_HOME: '/fixture/cache' };
  const child = bundleEnvironment(parent);
  assert.equal(child.NODE_ENV, 'production');
  assert.equal(child.EXPO_PUBLIC_API_URL, undefined);
  assert.equal(child.EXPO_PUBLIC_SUPABASE_ANON_KEY, undefined);
  assert.equal(child.XDG_CACHE_HOME, parent.XDG_CACHE_HOME);
  assert.equal(parent.EXPO_PUBLIC_API_URL, 'https://example.test');
});

test('bundle budget measures the actual Metro entry, excludes maps and fails oversize exports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-perf-'));
  const source = 'console.log("fixture");';
  try {
    writeFileSync(join(directory, 'metadata.json'), JSON.stringify({ bundler: 'metro', fileMetadata: { ios: { bundle: 'entry.js' } } }));
    writeFileSync(join(directory, 'entry.js'), source);
    writeFileSync(join(directory, 'entry.js.map'), 'x'.repeat(100_000));
    const measured = measureBundle(directory);
    assert.deepEqual(measured, { jsBytes: Buffer.byteLength(source), gzipBytes: gzipSync(source, { level: 9 }).length });
    const budget = { iosMinifiedJsBytes: measured.jsBytes, iosGzipJsBytes: measured.gzipBytes };
    checkBundle(measured, budget);
    assert.throws(() => checkBundle(measured, { ...budget, iosMinifiedJsBytes: measured.jsBytes - 1 }), /JS budget exceeded/);
    assert.throws(() => checkBundle(measured, { ...budget, iosGzipJsBytes: measured.gzipBytes - 1 }), /gzip budget exceeded/);
    assert.throws(() => checkBundle({ jsBytes: 0, gzipBytes: 0 }, budget), /empty/);
    for (const bundle of ['../outside.js', 'entry.hbc']) {
      writeFileSync(join(directory, 'metadata.json'), JSON.stringify({ bundler: 'metro', fileMetadata: { ios: { bundle } } }));
      assert.throws(() => measureBundle(directory));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the real entrypoint resolves the current API and enforces the zero-provider budget', () => {
  const result = checkPerformance();
  assert.equal(result.entrypoints, 11);
  assert.ok(result.reachableModules > result.entrypoints);
  assert.deepEqual(result.preloadProviders, []);
});
