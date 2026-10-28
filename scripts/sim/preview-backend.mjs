#!/usr/bin/env node
// Read-only host preflight. Resolve one backend before building or starting Metro.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, repoEnv } from '../verify/product-flow.mjs';
import { backend } from './product-flow.mjs';
import { backendOrigin } from './backend-identity.mjs';

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
  // `vercel list --format json` omits deployment ids, so bind to the health-reported revision and id instead.
  if (identity.backendRevision !== head || !/^dpl_/.test(identity.backendDeployment || '') ||
      (candidate.id && identity.backendDeployment !== candidate.id))
    throw new Error('Selected preview no longer matches the PR head and deployment identity');
  return { head, backend: selected, ...identity };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: preview-backend.mjs <full-checkout-head-sha>');
    console.log(JSON.stringify(selectBackend(process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
