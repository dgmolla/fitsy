import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let root: string;
const source = 'a'.repeat(40);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-manual-ota-'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'event.json'), JSON.stringify({ inputs: { approve_production_ota: 'true' } }));
  // Only GitHub is replaced. Admission, current-source and workflow checks run
  // through their actual production entrypoint and existing release helper.
  writeFileSync(join(root, 'bin/gh'), `#!/usr/bin/env node
const endpoint=process.argv.at(-1), scenario=process.env.OTA_SCENARIO;
const out=value=>process.stdout.write(JSON.stringify(value));
if(endpoint.endsWith('git/ref/heads/main')) out({object:{sha:scenario==='superseded'?'b'.repeat(40):'${source}'}});
else if(endpoint.includes('actions/workflows/verify.yml/runs?')) {
  const row={id:123,head_sha:'${source}',path:'.github/workflows/verify.yml',event:'push',head_branch:'main',
    repository:{full_name:'dgmolla/fitsy'},head_repository:{full_name:'dgmolla/fitsy'},status:'completed',conclusion:'success'};
  const changes={failed:{conclusion:'failure'},running:{status:'in_progress'},old:{head_sha:'b'.repeat(40)},
    wrongWorkflow:{path:'.github/workflows/fake.yml'},pullRequest:{event:'pull_request'},feature:{head_branch:'feature'},
    fork:{head_repository:{full_name:'someone/fitsy'}},wrongRepo:{repository:{full_name:'someone/fitsy'}}};
  out({workflow_runs:scenario==='missing'?[]:[{...row,...changes[scenario]}]});
} else process.exit(99);
`, { mode: 0o755 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(extra: Record<string, string> = {}) {
  return spawnSync('python3', [resolve(__dirname, 'manual-ota-release.py')], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
      PATH: `${join(root, 'bin')}:${process.env.PATH}`, GITHUB_EVENT_PATH: join(root, 'event.json'),
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'dgmolla/fitsy', GITHUB_ACTOR: 'dgmolla', GITHUB_SHA: source, ...extra },
  });
}
test('accepts Dawit-approved exact current main with the latest successful main push Verify', () => {
  const result = run();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ release_sha: source, verify_run_id: 123, approved_by: 'dgmolla' });
});
test.each([
  { GITHUB_ACTOR: 'another-user' }, { GITHUB_REF: 'refs/heads/feature' },
  { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REPOSITORY: 'someone/fitsy' }, { GITHUB_SHA: 'abc' },
])('refuses unauthorized dispatch context %j', extra => {
  expect(run(extra).status).toBe(1);
});
test.each(['false', '', false, 1])('requires explicit approval: %j', approved => {
  writeFileSync(join(root, 'event.json'), JSON.stringify({ inputs: { approve_production_ota: approved } }));
  expect(run().status).toBe(1);
});
test.each(['superseded', 'missing', 'failed', 'running', 'old', 'wrongWorkflow', 'pullRequest', 'feature', 'fork', 'wrongRepo'])(
  'fails closed for %s main/Verify evidence', scenario => {
    expect(run({ OTA_SCENARIO: scenario }).status).toBe(1);
  });
