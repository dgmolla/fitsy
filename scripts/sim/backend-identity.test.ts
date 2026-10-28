import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as capturedCli from './__snapshots__/clean-cli-deployment.json';
import * as dirtyCli from './__snapshots__/dirty-cli-deployment.json';
const modulePath = resolve(__dirname, 'backend-identity.mjs');
const sha = '9b565c82be7c127761c025db1670bc3677f2575d';
// Shape observed from a real clean CLI preview upload before its first Git push.
const cli = capturedCli;
function run(deployment: unknown) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {backendRevision} from ${JSON.stringify(modulePath)}; process.stdout.write(backendRevision(${JSON.stringify(deployment)}));`], { encoding: 'utf8' });
}
test('accepts real CLI identity and existing Git builds', () => {
  for (const d of [cli, { ...cli, source: 'git', meta: { gitDirty: null }, gitSource: { sha } },
    ...[false, 'false', '0'].map(gitDirty => ({ ...cli, meta: { ...cli.meta, gitDirty } }))]) {
    const result = run(d); expect(result.status).toBe(0); expect(result.stdout.trim()).toBe(sha);
  }
});
test.each([true, 'true', '1', 'unknown'])('rejects dirty or unknown CLI state %s', dirty => {
  const result = run({ ...cli, meta: { ...cli.meta, gitDirty: dirty } });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('uncommitted changes');
});
test('rejects the captured actual dirty CLI upload', () => {
  const result = run(dirtyCli); expect(result.status).not.toBe(0); expect(result.stderr).toContain('uncommitted changes');
});
test.each([
  { ...cli, readyState: 'BUILDING' }, { ...cli, target: 'production' },
  { ...cli, source: 'api' }, { ...cli, meta: {} },
  { ...cli, meta: { gitCommitSha: 'HEAD' } },
  { ...cli, gitSource: { sha: 'invalid' } },
])('rejects an unverified deployment', deployment => expect(run(deployment).status).not.toBe(0));

const preview = 'https://fitsy-api-git-codex-issue-583-dawits-projects-74b6e00f.vercel.app';
test.each(['https://dev.fitsy.org', preview,
  'https://fitsy-api-abc123-dawits-projects-74b6e00f.vercel.app',
  'https://fitsy-immutable123-dawits-projects-74b6e00f.vercel.app'])('shares a guarded backend with Maestro: %s', origin => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {backendOrigin,maestroApiArgs} from ${JSON.stringify(modulePath)};
     process.stdout.write(JSON.stringify([backendOrigin(${JSON.stringify(origin)}),maestroApiArgs({EXPO_PUBLIC_API_URL:${JSON.stringify(origin)}})]));`], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([origin, ['-e', `EXPO_PUBLIC_API_URL=${origin}`]]);
});

test.each(['', 'https://api.fitsy.org', 'https://fitsy.org', 'http://dev.fitsy.org',
  'https://dev.fitsy.org@evil.test', 'https://dev.fitsy.org.evil.test', 'https://dev.fitsy.org:443',
  'https://unrelated.vercel.app', 'https://fitsy-api-branch-other-team.vercel.app',
  'https://fitsy-api-branch-dawits-projects-74b6e00f.vercel.app.evil.test',
  preview + '/api', preview + '?token=secret', preview + '#fragment'])('rejects unsafe backend origins: %s', origin => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {backendOrigin} from ${JSON.stringify(modulePath)}; backendOrigin(${JSON.stringify(origin)});`], { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('refuses production');
});

test('preview selection retains ready, nonproduction, project and clean source checks', () => {
  for (const changes of [{ name: 'other-project' }, { target: 'production' }, { readyState: 'BUILDING' },
    { meta: { ...cli.meta, gitDirty: 'true' } }]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {backendRevision} from ${JSON.stringify(modulePath)};
       backendRevision(${JSON.stringify({ ...cli, name: 'fitsy-api', ...changes })}, ${JSON.stringify(preview)});`], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
  }
});

test('the real native backend check queries the preview and refuses divergent or dirty API source', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'fitsy-backend-preview-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', timeout: 10000 }).trim();
  const commit = (message: string) => {
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  const source = resolve(dir, 'apps/api/source.ts');
  try {
    // Own the history: origin/main may already have exactly the candidate's API contents.
    git('init', '-q');
    git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
    mkdirSync(resolve(dir, 'apps/api'), { recursive: true });
    writeFileSync(source, 'export const revision = 1;\n');
    const previous = commit('base fixture');
    const candidate = 'export const revision = 2;\n';
    writeFileSync(source, candidate);
    const equivalent = commit('candidate fixture');
    writeFileSync(resolve(dir, 'notes.txt'), 'non-API change\n');
    const head = commit('candidate notes');
    const script = `import {backend} from ${JSON.stringify(resolve(__dirname, 'product-flow.mjs'))}; process.stdout.write(JSON.stringify(backend()));`;
    for (const state of ['clean', 'equivalent', 'older', 'dirty', 'untracked']) {
      const revision = state === 'older' ? previous : state === 'equivalent' ? equivalent : head;
      if (state === 'dirty') writeFileSync(source, 'export const revision = 3;\n');
      const untracked = resolve(dir, 'apps/api/untracked.ts');
      if (state === 'untracked') writeFileSync(untracked, 'export const untracked = true;\n');
      writeFileSync(resolve(dir, 'vercel'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(resolve(dir, 'args.json'))},JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ ...cli, name: 'fitsy-api', meta: { gitCommitSha: revision } }))});\n`, { mode: 0o755 });
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: dir, env: { ...env, PATH: dir + ':' + env.PATH, FITSY_PRODUCT_ROOT: dir, EXPO_PUBLIC_API_URL: preview },
        encoding: 'utf8', timeout: 10000,
      });
      expect(result.error).toBeUndefined();
      expect(JSON.parse(readFileSync(resolve(dir, 'args.json'), 'utf8'))).toEqual(['api',
        '/v13/deployments/' + new URL(preview).hostname, '--raw']);
      const matches = state === 'clean' || state === 'equivalent';
      expect({ state, status: result.status }).toEqual({ state, status: matches ? 0 : 1 });
      if (matches) expect(JSON.parse(result.stdout)).toEqual({ backendRevision: revision, backendDeployment: cli.id });
      else expect(result.stderr).toContain('Deploy candidate backend/shared/schema changes');
      writeFileSync(source, candidate); rmSync(untracked, { force: true });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
