import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { publishScope, scopeDescription } from './sim-scope-status.mjs';
import { simulatorFlows, simulatorSelection } from './impact-plan.mjs';

const yaml = createRequire(import.meta.url)('js-yaml');
const head = 'a'.repeat(40);
const selection = () => ({ version: 1, comparison: { head, unknown: false }, simulator: simulatorSelection(null) });
function api() {
  const context = { eventName: 'workflow_run', repo: { owner: 'dgmolla', repo: 'fitsy' },
    payload: { workflow_run: { id: 123 } }, serverUrl: 'https://github.com' };
  const run = { id: 123, workflow_id: 456, run_attempt: 2, head_sha: head, path: '.github/workflows/verify.yml',
    name: 'Verify', event: 'pull_request', status: 'completed', conclusion: 'failure', repository: { full_name: 'dgmolla/fitsy' } };
  const jobs = [{ name: 'classify', conclusion: 'success', started_at: '2026-10-24T10:00:00Z' }];
  const recent = { workflow_runs: [{ id: 123 }] };
  const pulls = [{ state: 'open', head: { sha: head }, base: { ref: 'main', repo: { full_name: 'dgmolla/fitsy' } } }];
  const artifacts = [{ id: 789, name: 'sim-scope', expired: false, created_at: '2026-10-24T10:01:00Z' }];
  const statuses = [];
  const github = { rest: {
    actions: { getWorkflowRun: async () => ({ data: run }), listWorkflowRuns: async () => ({ data: recent }),
      listJobsForWorkflowRunAttempt: async params => {
        assert.equal(params.attempt_number, 2); return jobs;
      }, listWorkflowRunArtifacts: async () => artifacts },
    repos: { listPullRequestsAssociatedWithCommit: async () => pulls,
      createCommitStatus: async status => { assert.ok(status.description.length <= 140); statuses.push(status); } },
  }, paginate: (method, params) => method(params) };
  return { github, context, run, jobs, recent, pulls, artifacts, statuses };
}
async function withArtifact(plan, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-scope-status-'));
  const file = join(directory, 'selection.json');
  try { writeFileSync(file, JSON.stringify(plan)); await callback(file, directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('protected publisher consumes real full selection and writes only Sim scope on the source head', async () => {
  const fixture = api(), plan = selection();
  assert.ok(`scope=full flows=${simulatorFlows().join(',')}`.length > 140);
  await withArtifact({ ...plan, context: 'AI review', command: 'throw new Error("must not execute")' }, async file => {
    await publishScope(fixture.github, fixture.context, file, 789);
    assert.deepEqual(fixture.statuses, [{ owner: 'dgmolla', repo: 'fitsy', sha: head, context: 'Sim scope', state: 'success',
      description: `scope=full flows=${plan.simulator.flows.length}`, target_url: 'https://github.com/dgmolla/fitsy/actions/runs/123' }]);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).simulator.flows, simulatorFlows());
  });
});

for (const [name, change] of [
  ['candidate head changed', f => { f.pulls[0].head.sha = 'b'.repeat(40); }],
  ['closed PR', f => { f.pulls[0].state = 'closed'; }],
  ['wrong base', f => { f.pulls[0].base.ref = 'other'; }],
  ['newer label/head run', f => { f.recent.workflow_runs[0].id = 124; }],
  ['cancelled Verify', f => { f.run.conclusion = 'cancelled'; }],
  ['failed classify', f => { f.jobs[0].conclusion = 'failure'; }],
  ['skipped classify', f => { f.jobs[0].conclusion = 'skipped'; }],
]) test(`no scope status for ${name}`, async () => {
  const fixture = api(); change(fixture);
  await withArtifact(selection(), file => publishScope(fixture.github, fixture.context, file, 789));
  assert.deepEqual(fixture.statuses, []);
});

for (const [name, change] of [
  ['wrong workflow path', f => { f.run.path = '.github/workflows/other.yml'; }],
  ['wrong repository', f => { f.run.repository.full_name = 'someone/else'; }],
  ['push source', f => { f.run.event = 'push'; }],
  ['unfinished run', f => { f.run.status = 'in_progress'; }],
  ['missing artifact', f => { f.artifacts.length = 0; }],
  ['duplicate artifacts', f => { f.artifacts.push({ ...f.artifacts[0], id: 790 }); }],
  ['expired artifact', f => { f.artifacts[0].expired = true; }],
  ['prior attempt artifact', f => { f.artifacts[0].created_at = '2026-10-24T09:00:00Z'; }],
  ['artifact replaced after download', f => { f.artifacts[0].id = 790; }],
]) test(`rejects ${name} without status writes`, async () => {
  const fixture = api(); change(fixture);
  await withArtifact(selection(), file => assert.rejects(publishScope(fixture.github, fixture.context, file, 789)));
  assert.deepEqual(fixture.statuses, []);
});

for (const [name, change] of [
  ['wrong head', p => { p.comparison.head = 'b'.repeat(40); }],
  ['unknown comparison', p => { p.comparison.unknown = true; }],
  ['invalid scope', p => { p.simulator.scope = 'success'; }],
  ['empty full set', p => { p.simulator.flows = []; }],
  ['omitted critical path', p => { p.simulator.flows = ['signin-options']; }],
  ['command as a flow', p => { p.simulator.flows[0] = '../execute.sh'; }],
  ['duplicate flow', p => { p.simulator.flows.push(p.simulator.flows[0]); }],
  ['not-required full set', p => { p.simulator.required = false; }],
  ['wrong mode', p => { p.simulator.mode = 'render'; }],
  ['missing smoke checkpoint', p => { Object.assign(p.simulator, { scope: 'smoke', mode: 'render', smoke: [] }); }],
]) test(`rejects selection with ${name}`, async () => {
  const plan = selection(), fixture = api(); change(plan);
  assert.throws(() => scopeDescription(plan, head));
  await withArtifact(plan, file => assert.rejects(publishScope(fixture.github, fixture.context, file, 789)));
  assert.deepEqual(fixture.statuses, []);
});

test('actual trusted workflow isolates credentials and runs its checked-out publisher on artifact data', async () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/sim-scope.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on, { workflow_run: { workflows: ['Verify'], types: ['completed'] } });
  assert.deepEqual(workflow.permissions, {});
  const job = workflow.jobs.publish;
  assert.equal(job.permissions.statuses, 'write');
  assert.equal(job.if, "github.event.workflow_run.event == 'pull_request'");
  assert.deepEqual(job.steps[0], { uses: 'actions/checkout@v4',
    with: { ref: '${{ github.workflow_sha }}', 'persist-credentials': false } });
  assert.ok(job.steps.every(step => !step.run && !step.uses?.includes('setup-node')));
  const download = job.steps.find(step => step.uses === 'actions/download-artifact@v4');
  assert.equal(download.with['artifact-ids'], '${{ steps.source.outputs.artifact-id }}');
  assert.equal(download.with.path, '${{ runner.temp }}/sim-scope');
  const originalWorkspace = process.env.GITHUB_WORKSPACE, originalTemp = process.env.RUNNER_TEMP, originalArtifact = process.env.SIM_SCOPE_ARTIFACT_ID;
  const script = Object.getPrototypeOf(async () => {}).constructor;
  try {
    process.env.GITHUB_WORKSPACE = new URL('../..', import.meta.url).pathname;
    const fixture = api(), outputs = {};
    await new script('github', 'context', 'core', job.steps.find(step => step.id === 'source').with.script)(
      fixture.github, fixture.context, { setOutput: (name, value) => { outputs[name] = value; } });
    assert.equal(outputs['artifact-id'], 789);
    await withArtifact(selection(), async (file, directory) => {
      // The workflow uses a fixed data path outside its trusted checkout.
      process.env.RUNNER_TEMP = directory; process.env.SIM_SCOPE_ARTIFACT_ID = '789';
      const { mkdirSync, copyFileSync } = await import('node:fs');
      mkdirSync(join(directory, 'sim-scope')); copyFileSync(file, join(directory, 'sim-scope/selection.json'));
      await new script('github', 'context', job.steps.at(-1).with.script)(fixture.github, fixture.context);
    });
    assert.equal(fixture.statuses.length, 1);
  } finally {
    if (originalWorkspace === undefined) delete process.env.GITHUB_WORKSPACE; else process.env.GITHUB_WORKSPACE = originalWorkspace;
    if (originalTemp === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = originalTemp;
    if (originalArtifact === undefined) delete process.env.SIM_SCOPE_ARTIFACT_ID; else process.env.SIM_SCOPE_ARTIFACT_ID = originalArtifact;
  }
});
