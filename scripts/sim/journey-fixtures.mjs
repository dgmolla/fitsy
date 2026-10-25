// Fixture preparation is local operator configuration, separate from candidate
// journeys. Real purchase/expiry/history cannot be fabricated by the runner.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { parseEnv } from 'node:util';
import { git, gitEnv, repository } from '../verify/impact-plan.mjs';

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
  if (fixture?.endsWith('-dev') && (!env.EXPO_PUBLIC_DEV_LOGIN_EMAIL?.trim() || !env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD?.trim()))
    throw new Error(`Fixture ${fixture} requires its own local dev login environment`);
  return { name: fixture || 'default', stores, prepare: entry?.prepare, env };
}

export async function withFixtureEnvironment(fixture, action) {
  const previous = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_')));
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
  // Pre-provision real billing histories; this bounded step selects/signs in.
  execFileSync(binary, [...args, flow, udid], { cwd: repository, env: gitEnv(), stdio: 'inherit', timeout: 60000 });
}

export function assertJourneyStore(fixture, built) {
  if (fixture.stores.length && !fixture.stores.includes(built.storeMode))
    throw new Error(`Fixture ${fixture.name} requires store ${fixture.stores.join(' or ')}; installed build uses ${built.storeMode}`);
}
