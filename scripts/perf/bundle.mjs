import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function measureBundle(directory) {
  const metadata = JSON.parse(readFileSync(join(directory, 'metadata.json'), 'utf8'));
  const bundle = metadata.fileMetadata?.ios?.bundle;
  assert.ok(metadata.bundler === 'metro' && typeof bundle === 'string' && bundle.endsWith('.js'), 'need a production iOS JS export with --no-bytecode');
  assert.ok(!relative(resolve(directory), resolve(directory, bundle)).startsWith('..'), 'bundle must be inside the export');
  const bytes = readFileSync(join(directory, bundle));
  return { jsBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length };
}
export function checkBundle(measured, budget) {
  assert.ok(measured.jsBytes > 0 && measured.gzipBytes > 0, 'empty bundle');
  assert.ok(measured.jsBytes <= budget.iosMinifiedJsBytes, `iOS JS budget exceeded: ${measured.jsBytes} > ${budget.iosMinifiedJsBytes}`);
  assert.ok(measured.gzipBytes <= budget.iosGzipJsBytes, `iOS gzip budget exceeded: ${measured.gzipBytes} > ${budget.iosGzipJsBytes}`);
}
export function bundleEnvironment(env) {
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('EXPO_PUBLIC_'))),
    NODE_ENV: 'production', BABEL_ENV: 'production', CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1',
    EXPO_NO_DOTENV: '1', FITSY_ALLOW_MISSING_PUBLIC_ENV: '1' };
}
function sourceDigest() {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'apps/mobile', 'packages/shared', 'package.json', 'package-lock.json'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) if (existsSync(join(root, path))) hash.update(path + '\0').update(readFileSync(join(root, path)));
  return hash.digest('hex');
}
export function buildBundle() {
  const identity = sourceDigest();
  const outputRoot = join(root, '.evidence/performance');
  mkdirSync(outputRoot, { recursive: true });
  const directory = mkdtempSync(join(outputRoot, 'export-'));
  // Deliberately keyless local export only. This command never publishes an OTA.
  const result = spawnSync(process.execPath, [join(root, 'node_modules/expo/bin/cli'), 'export', '--platform', 'ios',
    '--no-bytecode', '--source-maps', '--max-workers', '2', '--output-dir', directory], { cwd: join(root, 'apps/mobile'),
    env: bundleEnvironment(process.env),
    encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(directory, 'export.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  assert.ok(!result.error && result.status === 0, `Expo export failed; inspect ${relative(root, directory)}/export.log`);
  assert.equal(sourceDigest(), identity, 'mobile inputs changed during measurement');
  const measured = measureBundle(directory);
  const receipt = { version: 1, sourceSha256: identity, measuredAt: new Date().toISOString(),
    mode: 'production minified iOS JS, keyless, no Hermes bytecode; gzip level 9', ...measured };
  writeFileSync(join(directory, 'measurement.json'), JSON.stringify(receipt, null, 2) + '\n');
  return { ...receipt, evidence: relative(root, directory) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.deepEqual(process.argv.slice(2), ['--build'], 'use npm run perf:bundle');
    const measured = buildBundle();
    checkBundle(measured, JSON.parse(readFileSync(join(root, 'scripts/perf/budgets.json'), 'utf8')));
    console.log(JSON.stringify({ name: 'mobile-bundle', status: 'pass', summary: 'production iOS JS fits measured size budgets', ...measured }));
  } catch (error) {
    console.log(JSON.stringify({ name: 'mobile-bundle', status: 'fail', summary: error.message, fix: 'inspect the export log; measure and explain dependency or route growth before changing budgets' }));
    process.exitCode = 1;
  }
}
