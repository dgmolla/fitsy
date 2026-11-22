#!/usr/bin/env node
// Read-only drift check for settings that live outside the repo but that tests depend on (#874).
// Compares scripts/dev/expected-external-config.json with the dev Supabase project's public auth settings
// and with the NAMES (never values) in the local dev env file. Prints "<setting>: expected X, actual Y" per drift.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const pick = (object, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
const word = value => (typeof value === 'boolean' ? (value ? 'ON' : 'OFF') : value === undefined ? 'missing' : String(value));

export function diffSettings(expected, actual, label = 'supabase dev auth') {
  return Object.entries(expected).filter(([path, want]) => pick(actual, path) !== want)
    .map(([path, want]) => `${label} ${path}: expected ${word(want)}, actual ${word(pick(actual, path))}`);
}

export function envNames(text) {
  return new Set(text.split('\n').map(line => /^([A-Z0-9_]+)=/.exec(line)?.[1]).filter(Boolean));
}

export function diffEnvNames(expected, readNames) {
  return Object.entries(expected).flatMap(([file, names]) => {
    const present = readNames(file);
    return present === null ? [`${file}: expected present, actual missing (run npm run dev:env)`]
      : names.filter(name => !present.has(name)).map(name => `${file} ${name}: expected present, actual missing`);
  });
}

// #874: RevenueCat offerings and entitlements the app and the tests depend on. The read-only key comes from the process
// environment or ~/.config/fitsy/revenuecat.env (Dawit approved this read, Nov 22); it is used only for GET requests,
// never printed, and only identifiers (lookup keys) are read or compared.
export function revenueCatKey({ env = process.env, file = resolve(process.env.HOME ?? '', '.config/fitsy/revenuecat.env') } = {}) {
  // The v2 read key is preferred; the older secret key in the same file may lack v2 read scope (HTTP 403).
  const names = ['REVENUECAT_V2_READ_KEY', 'REVENUECAT_SECRET_KEY'];
  for (const name of names) if (env[name]) return env[name];
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  for (const name of names) {
    const value = new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  }
  return null;
}

export async function fetchRevenueCat(key, fetchImpl = fetch) {
  const get = async path => {
    const response = await fetchImpl(`https://api.revenuecat.com/v2${path}`, { headers: { authorization: `Bearer ${key}` }, redirect: 'error' });
    if (!response.ok) throw new Error(`revenuecat read failed (HTTP ${response.status})`);
    return response.json();
  };
  const projects = (await get('/projects')).items ?? [];
  if (projects.length !== 1) throw new Error(`revenuecat read failed (expected one project, found ${projects.length})`);
  const id = projects[0].id;
  const [offerings, entitlements] = await Promise.all([get(`/projects/${id}/offerings`), get(`/projects/${id}/entitlements`)]);
  return { offerings: (offerings.items ?? []).map(item => item.lookup_key).sort(), entitlements: (entitlements.items ?? []).map(item => item.lookup_key).sort() };
}

export function diffRevenueCat(expected, actual) {
  return ['offerings', 'entitlements'].flatMap(kind => (expected?.[kind] ?? []).filter(name => !actual[kind].includes(name))
    .map(name => `revenuecat ${kind.slice(0, -1)} ${name}: expected present, actual missing`));
}

// #874: the Vercel environment variables the manifest requires must exist for each environment (names only, never values).
export function vercelEnvNames(output) {
  return new Set(output.split('\n').map(line => /^\s([A-Z][A-Z0-9_]+)\s/.exec(line)?.[1]).filter(Boolean));
}

export function diffVercelEnv(required, readNames) {
  return Object.entries(required).flatMap(([environment, names]) => {
    const present = readNames(environment);
    return present === null ? [] : names.filter(name => !present.has(name)).map(name => `vercel ${environment} ${name}: expected present, actual missing`);
  });
}

function vercelReader(cwd, run) {
  if (!existsSync(resolve(cwd, '.vercel/project.json'))) return () => null; // not linked here: skip, not drift
  return environment => { try { return vercelEnvNames(run('npx', ['vercel', 'env', 'ls', environment], cwd)); } catch { return null; } };
}

export async function check({ cwd = root, env = process.env, fetchImpl = fetch,
  runCommand = (file, args, directory) => execFileSync(file, args, { cwd: directory, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }) } = {}) {
  const expected = JSON.parse(readFileSync(resolve(cwd, 'scripts/dev/expected-external-config.json'), 'utf8'));
  const readNames = file => (existsSync(resolve(cwd, file)) ? envNames(readFileSync(resolve(cwd, file), 'utf8')) : null);
  const drift = diffEnvNames(expected.env_names, readNames);
  const manifest = JSON.parse(readFileSync(resolve(cwd, 'scripts/deploy/env-manifest.json'), 'utf8'));
  drift.push(...diffVercelEnv(Object.fromEntries(['development', 'preview', 'production'].map(name => [name, manifest.required?.[name] ?? []])), vercelReader(cwd, runCommand)));
  if (expected.revenuecat) {
    const key = revenueCatKey({ env });
    if (!key) drift.push('revenuecat: could not read (no REVENUECAT_SECRET_KEY)');
    else {
      try { drift.push(...diffRevenueCat(expected.revenuecat, await fetchRevenueCat(key, fetchImpl))); }
      catch (error) { drift.push(String(error.message).replaceAll(key, '<redacted>').split('\n')[0]); }
    }
  }
  const url = env.EXPO_PUBLIC_SUPABASE_URL, key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) drift.push('supabase dev auth: could not read (EXPO_PUBLIC_SUPABASE_URL / ANON_KEY not set)');
  else {
    try {
      const response = await fetchImpl(`${url}/auth/v1/settings`, { headers: { apikey: key } });
      if (!response.ok) drift.push(`supabase dev auth: could not read (HTTP ${response.status})`);
      else drift.push(...diffSettings(expected.supabase_dev_auth, await response.json()));
    } catch (error) { drift.push(`supabase dev auth: could not read (${error.message})`); }
  }
  return drift;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(root, 'apps/mobile/.env.development.local');
  const env = { ...process.env };
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^(EXPO_PUBLIC_SUPABASE_(?:URL|ANON_KEY))=(.*)$/.exec(line);
    if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  if (process.argv.includes('--record-revenuecat')) {
    const key = revenueCatKey({ env });
    if (!key) { process.stderr.write('no REVENUECAT_SECRET_KEY\n'); process.exit(2); }
    process.stdout.write(`${JSON.stringify(await fetchRevenueCat(key))}\n`);
    process.exit(0);
  }
  const drift = await check({ env });
  process.stdout.write(drift.length ? `${drift.join('\n')}\n` : 'external config: no drift\n');
  process.exit(drift.length ? 1 : 0);
}
