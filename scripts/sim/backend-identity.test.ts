import { spawnSync } from 'node:child_process';
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
