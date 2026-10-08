#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Exact source equality is deliberately conservative. A changed JS-only lock
// entry may require a new reviewed baseline; native changes never fail open.
export const nativePaths = [
  'package.json', 'package-lock.json', '.npmrc', '.easignore', 'app.json', 'app.config.*',
  'expo.config.*', 'react-native.config.*',
  'apps/mobile/package.json', 'apps/mobile/app.config.*', 'apps/mobile/eas.json',
  'apps/mobile/app.json', 'apps/mobile/.npmrc', 'apps/mobile/.easignore',
  'apps/mobile/expo.config.*', 'apps/mobile/react-native.config.*',
  'apps/mobile/ios', 'apps/mobile/android', 'apps/mobile/plugins',
  'apps/mobile/.eas', '.eas', 'patches', 'apps/mobile/assets',
  // This image is required by TrialArtwork.tsx at JS bundle export time.
  // It is absent from the binary's source and is not a native config resource.
  ':(exclude)apps/mobile/assets/app-screenshot.png',
];

export function checkCompatibility(root, { productionEnv = false, env = process.env } = {}) {
  const gitEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
  const git = args => execFileSync('git', args, { cwd: root, env: gitEnv, encoding: 'utf8' }).trim();
  const baseline = JSON.parse(readFileSync(resolve(root, 'scripts/deploy/ios-binary-baseline.json'), 'utf8'));
  if (baseline.version !== 1 || baseline.platform !== 'ios' ||
      !/^[a-f0-9]{40}$/.test(baseline.source_sha) || baseline.channel !== 'production' ||
      !/^[a-f0-9-]{36}$/.test(baseline.eas_build_id) || !/^[a-f0-9-]{36}$/.test(baseline.asc_build_id) ||
      !/^[a-f0-9]{64}$/.test(baseline.ipa_sha256) || !baseline.runtime_version ||
      !baseline.build_number || !baseline.bundle_id || !baseline.google_ios_client_id)
    throw new Error('Missing or invalid verified iOS binary baseline');
  const head = git(['rev-parse', 'HEAD']);
  git(['cat-file', '-e', `${baseline.source_sha}^{commit}`]);
  const changed = git(['diff', '--name-only', baseline.source_sha, head, '--', ...nativePaths]);
  const dirty = git(['status', '--porcelain', '--untracked-files=all', '--ignored', '--', ...nativePaths]);
  if (changed || dirty) throw new Error(`iOS native inputs differ from build ${baseline.build_number}; ship and verify a binary before OTA:\n${changed}\n${dirty}`.trim());
  if (productionEnv && env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID !== baseline.google_ios_client_id)
    throw new Error('Production Google iOS URL scheme differs from the verified binary; OTA cannot register a native scheme');
  return { compatible: true, platform: 'ios', source_sha: head, baseline_source_sha: baseline.source_sha,
    eas_build_id: baseline.eas_build_id, runtime_version: baseline.runtime_version, channel: baseline.channel,
    production_env_checked: productionEnv };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  try { console.log(JSON.stringify(checkCompatibility(root, { productionEnv: process.argv.includes('--production-env') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
