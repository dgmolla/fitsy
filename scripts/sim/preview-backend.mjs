#!/usr/bin/env node
// Read-only host preflight. Resolve one backend before building or starting Metro.
import { execFileSync } from 'node:child_process';
import { isMain } from '../verify/impact-plan.mjs';
import { root, repoEnv } from '../verify/product-flow.mjs';
import { backend } from './product-flow.mjs';
import { backendOrigin, backendRevision } from './backend-identity.mjs';

const run = (command, args) => execFileSync(command, args, {
  cwd: root, env: repoEnv(), encoding: 'utf8', timeout: 30000, maxBuffer: 2 << 20, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

export function selectBackend(head, value = process.env.EXPO_PUBLIC_API_URL) {
  if (!/^[a-f0-9]{40}$/.test(head || '') || run('git', ['rev-parse', 'HEAD']) !== head)
    throw new Error('Backend selection requires the exact current checkout head');
  const origin = backendOrigin(value);
  try {
    return { head, backend: origin, ...backend(origin) };
  } catch (error) {
    // Only stable dev with different source needs automatic PR discovery.
    // Explicit previews and inspection/configuration failures retain their error.
    if (origin !== 'https://dev.fitsy.org' || error.code !== 'FITSY_BACKEND_SOURCE_MISMATCH') throw error;
  }
  const listing = JSON.parse(run('vercel', ['list', 'fitsy-api', '--scope', 'dawits-projects-74b6e00f',
    '--environment', 'preview', '--status', 'READY', '--meta', `githubCommitSha=${head}`, '--format', 'json']));
  const candidate = Array.isArray(listing?.deployments) ? listing.deployments.find(d => d.name === 'fitsy-api' && d.state === 'READY' &&
    d.target !== 'production' && d.meta?.githubCommitSha === head) : null;
  if (!candidate) throw new Error('No Ready fitsy-api preview for this PR head; deploy it before Simulator replay');
  // Use the immutable deployment URL, never reassign dev or rely on a moving branch alias.
  const selected = backendOrigin(`https://${candidate.url}`);
  const identity = backend(selected);
  // `vercel list --format json` omits deployment ids; inspect the immutable URL to bind its revision and id.
  if (identity.backendRevision !== head || !/^dpl_/.test(identity.backendDeployment || '') ||
      (candidate.id && identity.backendDeployment !== candidate.id))
    throw new Error('Selected preview no longer matches the PR head and deployment identity');
  return { head, backend: selected, ...identity };
}

// The isolated recovery runner consumes this public response instead of host
// Vercel credentials. Selection above independently verifies revision and origin.
export function recoveryBackend(head) {
  const selected = selectBackend(head);
  const deployment = JSON.parse(run('vercel', ['api', `/v13/deployments/${new URL(selected.backend).hostname}`, '--raw']));
  if (deployment.id !== selected.backendDeployment || backendRevision(deployment, selected.backend) !== selected.backendRevision)
    throw new Error('Recovery backend deployment changed during selection');
  const { id, name, readyState, target, source } = deployment;
  // Get-deployment responses can contain private build configuration. Only the
  // identity fields consumed by backendRevision cross into candidate execution.
  return { ...selected, deployment: { id, name, readyState, target, source,
    ...(deployment.gitSource ? { gitSource: { sha: deployment.gitSource.sha } }
      : { meta: { gitCommitSha: deployment.meta?.gitCommitSha, gitDirty: deployment.meta?.gitDirty } }) } };
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2), recovery = args.length === 2 && args[0] === '--recovery';
    if (args.length !== 1 && !recovery) throw new Error('Usage: preview-backend.mjs [--recovery] <full-checkout-head-sha>');
    console.log(JSON.stringify(recovery ? recoveryBackend(args[1]) : selectBackend(args[0])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
