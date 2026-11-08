// Fixture preparation is local operator configuration, separate from candidate
// journeys. Real purchase/expiry/history cannot be fabricated by the runner.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { parseEnv } from 'node:util';
import { git, gitEnv, repository } from '../verify/impact-plan.mjs';

// Owner6716597294 grants exactly this release exception, never a passing flow.
// Check the published PR head and current grant again at admission, not a cached
// permission or a caller-created fixture receipt.
export async function releaseExceptions(names, catalog, approvalId, execute = (binary, args) =>
  execFileSync(binary, args, { cwd: repository, env: gitEnv(), encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim()) {
  if (!approvalId) return [];
  if (approvalId !== '6716597294') throw new Error('Unknown native release exception');
  let approval, pr, head, secondParent;
  try {
    const readAuthority = async path => {
      if (process.env.GITHUB_ACTIONS !== 'true') return JSON.parse(execute('gh', ['api', path]));
      // These two resources are public. The hosted native job intentionally has
      // no GitHub token or ambient CLI login; do not add privileged credentials.
      const response = await fetch(`https://api.github.com/${path}`, {
        headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error('Public approval lookup failed');
      return response.json();
    };
    approval = await readAuthority('repos/dgmolla/fitsy/issues/comments/6716597294');
    pr = await readAuthority('repos/dgmolla/fitsy/pulls/754');
    head = execute('git', ['rev-parse', 'HEAD']);
    if (head !== pr.head.sha) secondParent = execute('git', ['rev-parse', 'HEAD^2']);
  } catch { throw new Error('Native release exception authority/source lookup unavailable'); }
  if (approval.id !== 6716597294 || approval.user?.login !== 'dgmolla' ||
      createHash('sha256').update(approval.body || '').digest('hex') !== '4a7c397987e38c1e2e30152aab1862661ef4f2f99946fae09c2c2f60509856fb' ||
      pr.state !== 'open' || pr.number !== 754 || pr.head?.ref !== 'codex/issue-753' ||
      pr.head.repo?.full_name !== 'dgmolla/fitsy' || !/^[a-f0-9]{40}$/.test(head) ||
      (head !== pr.head.sha && (process.env.GITHUB_ACTIONS !== 'true' || secondParent !== pr.head.sha ||
        process.env.GITHUB_SHA !== head)))
    throw new Error('Native release exception does not match the current owner grant and published PR754 source');
  const flow = 'subscription-restore-expired';
  if (!names.includes(flow)) return [];
  const tags = catalog[flow]?.tags || [];
  if (tags.filter(tag => tag.startsWith('fixture:')).join() !== 'fixture:apple-history' ||
      tags.filter(tag => tag.startsWith('store:')).join() !== 'store:apple-simulator')
    throw new Error('Excepted Apple-history journey contract changed');
  return [{ flow, status: 'EXCEPTED', reason: 'unprovisioned real Apple purchase history',
    approval: 'https://github.com/dgmolla/fitsy/issues/755#issuecomment-6716597294',
    release: 'map/#746', source: head, prHead: pr.head.sha,
    fixture: 'apple-history', store: 'apple-simulator' }];
}

function localFile(file) {
  if (!isAbsolute(file || '')) throw new Error('Fixture files must use absolute local paths');
  const resolved = realpathSync(file), path = relative(repository, resolved);
  if (!path.startsWith('../') && git(['ls-files', '--', path]))
    throw new Error('Fixture configuration and environments must not be tracked in the repository');
  return resolved;
}

export function journeyFixture(header, file = process.env.FITSY_E2E_FIXTURES) {
  const tags = header.tags || [];
  const fixtures = tags.filter(tag => tag.startsWith('fixture:')).map(tag => tag.slice(8));
  const stores = tags.filter(tag => tag.startsWith('store:')).map(tag => tag.slice(6));
  if (fixtures.length > 1) throw new Error('A journey must have one starting fixture');
  const fixture = fixtures[0];
  if (!file && fixture) throw new Error(`Local fixture ${fixture} is required; set FITSY_E2E_FIXTURES before running this selection`);
  const config = file ? JSON.parse(readFileSync(localFile(file), 'utf8')) : { version: 1, fixtures: {} };
  if (config.version !== 1 || !config.fixtures || typeof config.fixtures !== 'object') throw new Error('Invalid local fixture configuration');
  const entry = config.fixtures[fixture || 'default'];
  if (fixture && !entry) throw new Error(`Missing local fixture preparation: ${fixture}`);
  if (entry && (!Array.isArray(entry.prepare) || !entry.prepare.length || !isAbsolute(entry.prepare[0]) ||
    entry.prepare.some(value => typeof value !== 'string' || !value || value.includes('\0'))))
    throw new Error('Fixture preparation requires an executable argv array with an absolute executable path');
  const env = entry?.envFile ? parseEnv(readFileSync(localFile(entry.envFile), 'utf8')) : {};
  if (Object.keys(env).some(key => !key.startsWith('EXPO_PUBLIC_')))
    throw new Error('Fixture environment files may only override EXPO_PUBLIC_ configuration');
  if ((fixture?.endsWith('-dev') || ['expired-subscription', 'empty-store'].includes(fixture)) &&
      (!env.EXPO_PUBLIC_DEV_LOGIN_EMAIL?.trim() || !env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD?.trim()))
    throw new Error(`Fixture ${fixture} requires its own local dev login environment`);
  return { name: fixture || 'default', stores, prepare: entry?.prepare, env };
}

export async function withFixtureEnvironment(fixture, action) {
  const previous = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_')));
  if (previous.EXPO_PUBLIC_API_URL && fixture.env.EXPO_PUBLIC_API_URL &&
      previous.EXPO_PUBLIC_API_URL !== fixture.env.EXPO_PUBLIC_API_URL)
    throw new Error('Fixture API origin differs from the selected run; keep EXPO_PUBLIC_API_URL consistent across accounts');
  Object.assign(process.env, fixture.env);
  try { return await action(); }
  finally {
    for (const key of Object.keys(process.env)) if (key.startsWith('EXPO_PUBLIC_')) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

export function prepareJourney(fixture, flow, udid) {
  if (!fixture.prepare) return;
  const [binary, ...args] = fixture.prepare;
  // The local adapter owns preparation's lease. It must finish/release before
  // the runner reacquires the device and independently validates the artifact.
  // Pre-provision real billing histories; adapter success is not native proof.
  // Debug billing runs independently verify history and sign in after Metro starts.
  execFileSync(binary, [...args, flow, udid], { cwd: repository, env: gitEnv(), stdio: 'inherit', timeout: 60000 });
}

export function assertJourneyStore(fixture, built) {
  if (fixture.stores.length && !fixture.stores.includes(built.storeMode))
    throw new Error(`Fixture ${fixture.name} requires store ${fixture.stores.join(' or ')}; installed build uses ${built.storeMode}`);
}
