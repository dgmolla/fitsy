// Loaded only from the protected workflow revision by sim-scope.yml.
// The downloaded candidate artifact is JSON data, never a module or command.
import { readFileSync } from 'node:fs';

const insist = (condition, message) => { if (!condition) throw new Error(message); };
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const flowName = value => typeof value === 'string' && /^[a-z0-9-]{1,100}$/.test(value);

export function scopeDescription(plan, head) {
  insist(plan?.version === 1 && plan.comparison?.head === head && sha(head) && plan.comparison.unknown === false,
    'Selection must name the verified PR head');
  const selection = plan.simulator;
  insist(selection && ['none', 'smoke', 'flow', 'full'].includes(selection.scope), 'Invalid simulator scope');
  const { scope, flows, smoke } = selection;
  insist(Array.isArray(flows) && flows.length <= 1000 && flows.every(flowName) && new Set(flows).size === flows.length,
    'Invalid simulator flow list');
  insist(selection.required === (scope !== 'none') && (scope === 'none') === (flows.length === 0),
    'Simulator scope and required flows disagree');
  insist(selection.mode === (scope === 'none' ? 'none' : scope === 'smoke' ? 'render' : 'e2e'), 'Invalid simulator mode');
  insist(Array.isArray(smoke) && (scope === 'smoke' ? smoke.length > 0 : smoke.length === 0), 'Invalid render checkpoints');
  for (const checkpoint of smoke) {
    insist(typeof checkpoint?.screen === 'string' && checkpoint.screen.startsWith('apps/mobile/') &&
      flows.includes(checkpoint.flow) && (typeof checkpoint.selector === 'string' ||
        (checkpoint.selector && typeof checkpoint.selector.id === 'string')), 'Invalid render checkpoint');
  }
  insist(scope !== 'smoke' || flows.every(flow => smoke.some(item => item.flow === flow)), 'Missing render checkpoint');
  insist(scope !== 'full' || ['signin-options', 'paywall-access', 'onboarding-guided-preview', 'log-meal'].every(flow => flows.includes(flow)),
    'Full scope is missing a critical path');
  // GitHub caps descriptions at 140 characters. Exact names/checkpoints stay
  // in selection.json; consumers read the artifact instead of parsing names here.
  const description = `scope=${scope} flows=${flows.length}`;
  insist(description.length <= 140, 'Sim scope description exceeds the GitHub limit');
  return description;
}

export async function scopeSource(github, context) {
  const repo = context.repo, runId = context.payload.workflow_run?.id;
  insist(context.eventName === 'workflow_run' && Number.isSafeInteger(runId), 'Expected a Verify completion event');
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: runId });
  insist(run.path === '.github/workflows/verify.yml' && run.name === 'Verify' && run.event === 'pull_request' &&
    run.status === 'completed' && sha(run.head_sha) && run.repository.full_name === `${repo.owner}/${repo.repo}`,
  'Unexpected source workflow');
  if (run.conclusion === 'cancelled') return null;
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt,
    { ...repo, run_id: runId, attempt_number: run.run_attempt, per_page: 100 });
  const classify = jobs.find(job => job.name === 'classify');
  if (classify?.conclusion !== 'success') return null;
  const { data: recent } = await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: run.workflow_id,
    event: 'pull_request', head_sha: run.head_sha, per_page: 1 });
  if (recent.workflow_runs[0]?.id !== runId) return null;
  const pulls = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit,
    { ...repo, commit_sha: run.head_sha, per_page: 100 });
  const current = pulls.filter(pr => pr.state === 'open' && pr.head.sha === run.head_sha &&
    pr.base.ref === 'main' && pr.base.repo.full_name === `${repo.owner}/${repo.repo}`);
  if (current.length !== 1) return null;
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts,
    { ...repo, run_id: runId, per_page: 100 });
  const selection = artifacts.filter(artifact => artifact.name === 'sim-scope' && !artifact.expired);
  insist(selection.length === 1 && Date.parse(selection[0].created_at) >= Date.parse(classify.started_at),
    'Missing or stale sim-scope artifact for this run attempt');
  return { head: run.head_sha, runId, artifactId: selection[0].id };
}

export async function publishScope(github, context, file, artifactId) {
  const source = await scopeSource(github, context); // Recheck after download to reject a superseded head/run.
  if (!source) return;
  insist(Number.isSafeInteger(artifactId) && artifactId === source.artifactId, 'Downloaded selection artifact was superseded');
  const bytes = readFileSync(file);
  insist(bytes.length <= 1024 * 1024, 'Simulator selection is too large');
  const description = scopeDescription(JSON.parse(bytes.toString('utf8')), source.head);
  await github.rest.repos.createCommitStatus({ ...context.repo, sha: source.head, context: 'Sim scope', state: 'success',
    description, target_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${source.runId}` });
}
