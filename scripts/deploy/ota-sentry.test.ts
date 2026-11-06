import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute the exact inline stage consumed by ordinary ota.sh; replace only EAS
// and the external Sentry uploader, without another implementation of the stage.
const source = readFileSync(resolve(__dirname, 'ota.sh'), 'utf8');
const stage = source.slice(source.indexOf('# Sentry source-map upload'), source.indexOf('# Verify: the newest update'));
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-ota-sentry-'));
  for (const path of ['bin', '.evidence/ota', 'dist']) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, 'dist/metadata.json'), JSON.stringify({ fileMetadata: { ios: { bundle: 'index.hbc' } } }));
  writeFileSync(join(root, 'dist/index.hbc'), 'synthetic bundle');
  writeFileSync(join(root, 'dist/index.hbc.map'), JSON.stringify({ debugId: '12345678-1234-1234-1234-123456789abc', sources: ['app/_layout.tsx'] }));
  writeFileSync(join(root, 'bin/npx'), `#!/usr/bin/env node
const fs=require('fs'),cp=require('child_process'),args=process.argv.slice(2);
if(args[0]==='eas-cli@18'){
  if(args[1]!=='env:exec'||args[2]!=='production'||args[4]!=='--non-interactive')process.exit(91);
  if(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)process.exit(92);
  const result=cp.spawnSync('bash',['-c',args[3]],{stdio:'inherit',env:process.env});process.exit(result.status??1);
}
if(args.join(' ')!=='--no-install sentry-expo-upload-sourcemaps dist')process.exit(93);
fs.writeFileSync('uploaded','yes');
// Adversarial provider diagnostics must remain in the private log.
process.stdout.write(process.env.SENTRY_AUTH_TOKEN);process.stderr.write(process.env.SENTRY_AUTH_TOKEN);
process.exit(process.env.UPLOAD_FAIL==='1'?1:0);
`, { mode: 0o755 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(extra: Record<string, string> = {}) {
  return spawnSync('bash', ['-c', stage], { cwd: root, encoding: 'utf8', env: {
    ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, REPO_ROOT: root, GROUP: 'synthetic-group',
    SENTRY_ORG: 'fixture-org', SENTRY_PROJECT: 'fixture-mobile', SENTRY_AUTH_TOKEN: 'fixture-upload-private',
    EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.test/1', GH_TOKEN: 'fixture-github', ...extra,
  } });
}

test('ordinary publication invokes the bounded upload before final bundle verification', () => {
  expect(stage).toContain('timeout=120');
  expect(source.indexOf('# Sentry source-map upload')).toBeGreaterThan(source.indexOf('npx eas-cli@18 update --platform ios'));
  expect(source.indexOf('# Verify: the newest update')).toBeLessThan(source.indexOf('OTA_MUTATION_IN_PROGRESS=0'));
  const result = run();
  expect(result.status).toBe(0);
  expect(existsSync(join(root, 'uploaded'))).toBe(true);
  expect(result.stdout + result.stderr).not.toContain('fixture-upload-private');
});

test('an unconfigured DSN leaves ordinary publication independent of Sentry', () => {
  expect(run({ EXPO_PUBLIC_SENTRY_DSN: '' }).status).toBe(0);
  expect(existsSync(join(root, 'uploaded'))).toBe(false);
});

test.each(['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'])('configured DSN without %s fails before upload and emits the release failure signal', name => {
  const result = run({ [name]: '' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Sentry source-map upload failed for published group synthetic-group');
  expect(existsSync(join(root, 'uploaded'))).toBe(false);
});

test('provider rejection is a failure with private diagnostics and an unreleased lease', () => {
  const result = run({ UPLOAD_FAIL: '1' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('reconcile the retained release lease');
  expect(result.stdout + result.stderr).not.toContain('fixture-upload-private');
  expect(stage).not.toContain('OTA_MUTATION_IN_PROGRESS=0');
});

test('missing debug IDs fail before the uploader can report a misleading success', () => {
  writeFileSync(join(root, 'dist/index.hbc.map'), JSON.stringify({ sources: ['app/_layout.tsx'] }));
  const result = run();
  expect(result.status).toBe(1);
  expect(existsSync(join(root, 'uploaded'))).toBe(false);
});
