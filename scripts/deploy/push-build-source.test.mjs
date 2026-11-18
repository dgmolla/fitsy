import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pushBuildSource, releaseIdentity } from './push-build-source.mjs';

const sh = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd, encoding: 'utf8' }).trim();
const config = n => `export default {\n  version: "1.0.1",\n  ios: {\n    buildNumber: "${n}",\n  },\n};\n`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'push-build-'));
  const remote = join(dir, 'remote.git');
  const work = join(dir, 'work');
  mkdirSync(remote); mkdirSync(join(work, 'apps/mobile'), { recursive: true });
  sh(remote, 'init', '--bare', '-q');
  sh(work, 'init', '-q');
  sh(work, 'remote', 'add', 'origin', remote);
  writeFileSync(join(work, 'apps/mobile/app.config.ts'), config('13'));
  sh(work, 'add', '.'); sh(work, 'commit', '-q', '-m', 'init');
  return { dir, remote, work, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('pushes the build tag so the exact local source resolves on the remote', () => {
  const f = fixture();
  try {
    const result = pushBuildSource({ cwd: f.work });
    assert.equal(result.tag, 'build/1.0.1-13');
    assert.equal(sh(f.remote, 'rev-parse', 'refs/tags/build/1.0.1-13'), sh(f.work, 'rev-parse', 'HEAD'));
    assert.deepEqual(pushBuildSource({ cwd: f.work }), result);
  } finally { f.cleanup(); }
});

test('refuses when tracked files are dirty', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.work, 'apps/mobile/app.config.ts'), config('14'));
    assert.throws(() => pushBuildSource({ cwd: f.work }), /uncommitted/);
  } finally { f.cleanup(); }
});

test('refuses to reuse a build tag that points at another commit', () => {
  const f = fixture();
  try {
    pushBuildSource({ cwd: f.work });
    writeFileSync(join(f.work, 'apps/mobile/app.config.ts'), `${config('13')}// changed\n`);
    sh(f.work, 'commit', '-q', '-am', 'later');
    assert.throws(() => pushBuildSource({ cwd: f.work }), /already points at/);
  } finally { f.cleanup(); }
});

test('refuses when the push cannot reach the remote', () => {
  const f = fixture();
  try {
    sh(f.work, 'remote', 'set-url', 'origin', join(f.dir, 'missing.git'));
    assert.throws(() => pushBuildSource({ cwd: f.work }));
  } finally { f.cleanup(); }
});

test('requires exactly one version and buildNumber line', () => {
  assert.deepEqual(releaseIdentity(config('9')), { version: '1.0.1', buildNumber: '9' });
  assert.throws(() => releaseIdentity('export default {};'), /exactly one/);
});
