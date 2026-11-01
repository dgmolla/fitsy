import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPollerStatus, patchPoller } from './install-poller-status.mjs';

const controls = fileURLToPath(new URL('.', import.meta.url));
const legacyTail = readFileSync(new URL('./fixtures/legacy-status-tail.txt', import.meta.url), 'utf8').trimEnd();
const head = 'a'.repeat(40);
// Minimal executable host caller with its unchanged deployed status blocks.
// The native driver and GitHub are external boundaries; lifecycle code is real.
const caller = `import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import { prepareExpiredFixture } from './expired-fixture.mjs';
const CONTEXT='Simulator', MAIN=false, stateFile='./state.json';
const state=JSON.parse(readFileSync(stateFile)), statuses=[];
const api=(path,method,body)=>{if(process.env.REJECT_STATUS==='1')throw new Error('GitHub offline');statuses.push({path,...body});return {id:123,...body};};
const setStatus = (sha, s, d) => api(\`statuses/\${sha}\`, 'POST', { state: s, context: CONTEXT, description: d.slice(0, 139) });
const save=()=>writeFileSync(stateFile,JSON.stringify(state)), log=()=>{};
const comment=()=>{throw new Error('comment unavailable');};
const scrub=s=>s;
for(const pr of [{number:689,headRefOid:'${head}'}]) {
  const sha=pr.headRefOid, st=state;
  let scope0 = 'full', flows0 = '';
  if (['success','failure','none','error'].includes(st.final)) continue;
  appendFileSync('./native-attempts.txt','attempt\\n');
  const scope=scope0, env={}, ev='.', verdict=process.env.RUN_PASS==='1'?{verdict:'pass',steps:['required assertions passed']}:undefined;
  const error=verdict?undefined:Object.assign(new Error('Optional reminder is not visible'),{gateFail:true});
${legacyTail}
}
console.log(JSON.stringify({state,statuses}));
`;

async function fixture(action) {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-poller-install-'));
  try {
    const source = join(directory, 'source'), host = join(directory, 'host');
    mkdirSync(join(source, 'scripts/sim'), { recursive: true }); mkdirSync(host);
    copyFileSync(join(controls, 'poller-status.mjs'), join(source, 'scripts/sim/poller-status.mjs'));
    const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8', env: {
      ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
    } }).trim();
    git(['init', '-q']); git(['config', 'core.hooksPath', '/dev/null']); git(['add', '.']);
    git(['commit', '-qm', 'isolated installer fixture']); git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(host, 'poller.mjs'), caller);
    writeFileSync(join(host, 'expired-fixture.mjs'), 'export function prepareExpiredFixture(){}');
    writeFileSync(join(host, 'state.json'), '{"tries":0}');
    const run = (reject = false, pass = false) => spawnSync(process.execPath, ['poller.mjs'], {
      cwd: host, encoding: 'utf8', env: { ...process.env, REJECT_STATUS: reject ? '1' : '0', RUN_PASS: pass ? '1' : '0' },
    });
    await action({ source, host, git, run });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
const result = process => { assert.equal(process.status, 0, process.stderr); return JSON.parse(process.stdout.trim().split('\n').at(-1)); };

test('the installed caller posts assertion failures with reasons, retries once, and survives comment failure', async () => fixture(({ source, host, run }) => {
  const installed = installPollerStatus(host, source);
  assert.equal(readFileSync(installed.backup, 'utf8'), caller);
  assert.equal(installPollerStatus(host, source).changed, false);
  assert.equal(existsSync(join(host, 'lock')), false);
  let actual = result(run());
  assert.equal(actual.state.tries, 1); assert.equal(actual.state.final, undefined);
  assert.match(actual.statuses[0].description, /Retry 1\/1 queued: Optional reminder is not visible/);
  assert.equal(actual.statuses[0].state, 'failure');
  actual = result(run());
  assert.equal(actual.state.tries, 2); assert.equal(actual.state.final, 'failure');
  assert.equal(actual.statuses[0].description, 'Optional reminder is not visible');
  assert.equal(readFileSync(join(host, 'attempts.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.deepEqual(result(run()).statuses, []);
  assert.equal(readFileSync(join(host, 'native-attempts.txt'), 'utf8'), 'attempt\nattempt\n');
}));

test('a passing retry posts success without erasing the original failure or accepting another attempt', async () => fixture(({ source, host, run }) => {
  installPollerStatus(host, source);
  result(run());
  const actual = result(run(false, true));
  assert.equal(actual.state.final, 'success'); assert.equal(actual.state.tries, 1);
  assert.equal(actual.statuses[0].state, 'success'); assert.match(actual.statuses[0].description, /full run \+ exploration passed/);
  const attempts = readFileSync(join(host, 'attempts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(attempts.map(({ attempt, status }) => ({ attempt, status })), [{ attempt: 1, status: 'failure' }, { attempt: 2, status: 'success' }]);
  assert.deepEqual(result(run()).statuses, []);
}));

test('the real caller resumes a failed publication before starting another native attempt', async () => fixture(({ source, host, run }) => {
  installPollerStatus(host, source);
  assert.notEqual(run(true).status, 0);
  const pending = JSON.parse(readFileSync(join(host, 'state.json'), 'utf8'));
  assert.equal(pending.tries, 1); assert.equal(pending.final, undefined); assert.ok(pending.pendingStatus);
  const actual = result(run());
  assert.equal(actual.state.tries, 1); assert.equal(actual.state.pendingStatus, undefined);
  assert.equal(actual.statuses[0].state, 'failure');
  assert.equal(readFileSync(join(host, 'native-attempts.txt'), 'utf8'), 'attempt\n');
}));

test('installation refuses active hosts, source drift and changed caller contracts', async () => fixture(({ source, host, git }) => {
  mkdirSync(join(host, 'lock'));
  assert.throws(() => installPollerStatus(host, source), /runner busy/);
  rmSync(join(host, 'lock'), { recursive: true });
  writeFileSync(join(source, 'dirty'), 'candidate');
  assert.throws(() => installPollerStatus(host, source), /clean reviewed checkout/);
  git(['add', '.']); git(['commit', '-qm', 'isolated unmerged fixture']);
  assert.throws(() => installPollerStatus(host, source), /clean reviewed checkout/);
  assert.throws(() => patchPoller(caller.replace('st.tries < 2', 'st.tries < 3')), /contract changed/);
  assert.equal(readFileSync(join(host, 'poller.mjs'), 'utf8'), caller);
  assert.equal(existsSync(join(host, 'lock')), false);
}));

test('a modified installed snapshot is refused and the installer releases its own lock', async () => fixture(({ source, host }) => {
  installPollerStatus(host, source);
  const module = join(host, 'status-modules', readdirSync(join(host, 'status-modules'))[0], 'poller-status.mjs');
  chmodSync(module, 0o600); writeFileSync(module, '// modified snapshot');
  assert.throws(() => installPollerStatus(host, source), /snapshot changed/);
  assert.equal(existsSync(join(host, 'lock')), false);
}));
