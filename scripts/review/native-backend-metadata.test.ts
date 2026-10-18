import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readdirSync, realpathSync, rmdirSync } from 'node:fs';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';

const caller = resolve(__dirname, '../sim/product-flow.mjs');
const envModule = resolve(__dirname, '../verify/product-flow.mjs');
const revision = '9b565c82be7c127761c025db1670bc3677f2575d';
const deployment = { id: 'dpl_fixture', readyState: 'READY', target: null, source: 'git', gitSource: { sha: revision } };

function invoke(selector: string | undefined, options: Record<string, unknown> = {}) {
  const program = `
    import { backend } from ${JSON.stringify(caller)};
    import { repoEnv } from ${JSON.stringify(envModule)};
    const options = ${JSON.stringify(options)}, calls = [];
    let reads = 0;
    function command(cmd, args) {
      calls.push([cmd, args]);
      if (cmd === 'git') return args[0] === 'diff' ? (options.diff || '') : (options.untracked || '');
      if (cmd === 'vercel') throw new Error('synthetic transport: no credentials');
      if (cmd !== '/opt/fitsy-approval/native-dev-metadata' || args.length) throw new Error('unexpected transport');
      const d = ${JSON.stringify(deployment)};
      if (options.second && ++reads === 2) d.gitSource.sha = 'invalid';
      return JSON.stringify({ ...d, ...(options.deployment || {}) });
    }
    try {
      const first = backend(command);
      if (options.second) backend(command);
      process.stdout.write(JSON.stringify({ first, calls, home: repoEnv().HOME, gitInjected: repoEnv().GIT_DIR }) + '\\n');
    } catch (e) { process.stdout.write(JSON.stringify({ error: e.message, calls }) + '\\n'); process.exitCode = 1; }
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_DIR: '/synthetic/injection' };
  delete env.FITSY_NATIVE_BACKEND_METADATA;
  if (selector !== undefined) env.FITSY_NATIVE_BACKEND_METADATA = selector;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env });
  if (!result.stdout.trim()) throw new Error(result.stderr);
  return { status: result.status, ...JSON.parse(result.stdout) };
}

test('unset retains exact original default and its no-credential failure', () => {
  const result = invoke(undefined);
  expect(result.error).toContain('no credentials');
  expect(result.calls).toEqual([['vercel', ['api', '/v13/deployments/dev.fitsy.org', '--raw']]]);
});
test.each(['unknown', '/tmp/helper', 'operator-dev ', 'https://evil'])('rejects selector %s before execution', selector => {
  const result = invoke(selector);
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
});
test('fixed helper accepts compatible metadata without changing neutral HOME or git sanitization', () => {
  const result = invoke('operator-dev');
  expect(result.status).toBe(0);
  expect(result.first).toEqual({ backendRevision: revision, backendDeployment: deployment.id });
  expect(result.calls).toEqual([
    ['/opt/fitsy-approval/native-dev-metadata', []],
    ['git', ['diff', '--name-only', revision, '--', 'apps/api', 'packages/shared', 'prisma', 'package.json', 'package-lock.json']],
    ['git', ['ls-files', '--others', '--exclude-standard', '--', 'apps/api', 'packages/shared', 'prisma']],
  ]);
  expect(result.home).toBe(process.env.HOME);
  expect(result.gitInjected).toBeUndefined();
});
test.each(['apps/api/route.ts', 'packages/shared/index.ts', 'prisma/schema.prisma', 'package.json', 'package-lock.json'])('rejects backend drift %s', diff => {
  expect(invoke('operator-dev', { diff }).error).toContain('Deploy candidate');
});
test('rejects untracked backend inputs and rereads on the second actual call', () => {
  expect(invoke('operator-dev', { untracked: 'apps/api/new.ts' }).status).toBe(1);
  const result = invoke('operator-dev', { second: true });
  expect(result.error).toContain('verified Git identity');
  expect(result.calls.filter(([cmd]: string[]) => cmd === '/opt/fitsy-approval/native-dev-metadata')).toHaveLength(2);
});
test.each([{ readyState: 'BUILDING' }, { target: 'production' }, { gitSource: { sha: 'bad' } }])('keeps canonical metadata rejection', value => {
  expect(invoke('operator-dev', { deployment: value }).status).toBe(1);
});

test.each([
  ['unset', false], ['shared', false], ['private', false], ['private', true],
] as const)('actual caller compares an owned disposable Git checkout, including tracked and untracked drift (TMPDIR=%s, assertion failure=%s)', (temp, fail) => {
  // Inherited command scratch is not authority to acquire a disposable checkout.
  const parent = realpathSync(platform() === 'darwin' ? '/private/tmp' : '/tmp');
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || parentStat.uid !== 0
      || (parentStat.mode & 0o1777) !== 0o1777) throw Error('Unsafe OS temp parent');
  const scratch = mkdtempSync(join(parent, 'native-metadata-'));
  const acquired = lstatSync(scratch);
  const assertScratch = () => {
    const current = lstatSync(scratch);
    if (!current.isDirectory() || current.isSymbolicLink() || current.uid !== process.getuid!()
        || current.uid !== acquired.uid || current.dev !== acquired.dev || current.ino !== acquired.ino
        || (current.mode & 0o077) || realpathSync(scratch) !== scratch) throw Error('Scratch identity changed');
  };
  try {
    assertScratch();
    const program = `
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { mkdtempSync, realpathSync, lstatSync, writeFileSync, mkdirSync, rmSync, unlinkSync, chmodSync, symlinkSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    import { backend } from ${JSON.stringify(caller)};
    import { repoEnv } from ${JSON.stringify(envModule)};
    const parent = ${JSON.stringify(scratch)};
    if (!parent || realpathSync(parent) !== parent || lstatSync(parent).isSymbolicLink()
        || lstatSync(parent).uid !== process.getuid() || (lstatSync(parent).mode & 0o077)) throw Error('Unowned scratch');
    const fixture = mkdtempSync(join(parent, 'native-metadata-git-'));
    const owned = lstatSync(fixture);
    const assertFixture = (path = fixture, identity = owned) => {
      const current = lstatSync(path);
      if (!current.isDirectory() || current.isSymbolicLink() || current.uid !== process.getuid()
          || current.uid !== identity.uid || current.dev !== identity.dev || current.ino !== identity.ino
          || (current.mode & 0o077) || realpathSync(path) !== path) throw Error('Unowned fixture');
    };
    const git = args => {
      assertFixture();
      return execFileSync('git', args, { cwd: fixture, env: repoEnv(), encoding: 'utf8' }).trim();
    };
    try {
      assertFixture();
      chmodSync(fixture, 0o755);
      assert.throws(() => git(['init', '--quiet']), /Unowned fixture/);
      assert.equal(existsSync(join(fixture, '.git')), false);
      chmodSync(fixture, 0o700);
      const alias = join(parent, 'symlink');
      symlinkSync(fixture, alias);
      try { assert.throws(() => assertFixture(alias), /Unowned fixture/); }
      finally { unlinkSync(alias); }
      assert.throws(() => assertFixture(fixture, { ...owned, ino: owned.ino + 1 }), /Unowned fixture/);
      assert.equal(existsSync(join(fixture, '.git')), false);
      git(['init', '--quiet', '--initial-branch=fixture']);
      git(['config', 'user.name', 'Synthetic metadata test']);
      git(['config', 'user.email', 'synthetic@example.invalid']);
      const paths = ['apps/api/route.ts', 'packages/shared/index.ts', 'prisma/schema.prisma', 'package.json', 'package-lock.json'];
      for (const path of paths) { mkdirSync(join(fixture, path, '..'), { recursive: true }); writeFileSync(join(fixture, path), 'original'); }
      git(['add', '.']); git(['commit', '--quiet', '-m', 'Disposable fixture']);
      const d = ${JSON.stringify(deployment)}; d.gitSource.sha = git(['rev-parse', 'HEAD']);
      process.env.FITSY_NATIVE_BACKEND_METADATA = 'operator-dev';
      const command = (cmd, args) => cmd === 'git' ? git(args) :
        cmd === '/opt/fitsy-approval/native-dev-metadata' && !args.length ? JSON.stringify(d) : (() => { throw Error('Unexpected transport'); })();
      backend(command);
      for (const path of paths) {
        writeFileSync(join(fixture, path), 'changed');
        let rejected = false; try { backend(command); } catch { rejected = true; }
        if (!rejected) throw Error('Tracked drift accepted');
        writeFileSync(join(fixture, path), 'original');
      }
      writeFileSync(join(fixture, 'apps/api/untracked.ts'), 'new');
      let rejected = false; try { backend(command); } catch { rejected = true; }
      if (!rejected) throw Error('Untracked drift accepted');
      if (${fail}) assert.fail('Synthetic assertion failure');
      process.stdout.write('owned Git fixture passed\\n');
    } finally {
      assertFixture();
      rmSync(fixture, { recursive: true });
    }
  `;
    const env = { ...process.env };
    if (temp === 'unset') delete env.TMPDIR;
    else env.TMPDIR = temp === 'shared' ? parent : scratch;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env });
    assertScratch();
    expect(readdirSync(scratch)).toEqual([]);
    if (fail) {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Synthetic assertion failure');
    } else {
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('owned Git fixture passed');
    }
  } finally {
    assertScratch();
    rmdirSync(scratch);
  }
});
