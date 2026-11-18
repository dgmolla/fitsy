#!/usr/bin/env node
// Read-only drift check for settings that live outside the repo but that tests depend on (#874).
// Compares scripts/dev/expected-external-config.json with the dev Supabase project's public auth settings
// and with the NAMES (never values) in the local dev env file. Prints "<setting>: expected X, actual Y" per drift.
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

export async function check({ cwd = root, env = process.env, fetchImpl = fetch } = {}) {
  const expected = JSON.parse(readFileSync(resolve(cwd, 'scripts/dev/expected-external-config.json'), 'utf8'));
  const readNames = file => (existsSync(resolve(cwd, file)) ? envNames(readFileSync(resolve(cwd, file), 'utf8')) : null);
  const drift = diffEnvNames(expected.env_names, readNames);
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
  const drift = await check({ env });
  process.stdout.write(drift.length ? `${drift.join('\n')}\n` : 'external config: no drift\n');
  process.exit(drift.length ? 1 : 0);
}
