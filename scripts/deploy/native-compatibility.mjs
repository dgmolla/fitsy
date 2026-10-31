#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { otaTarget } from './ota-target.mjs';

export function checkCompatibility(root, { productionEnv = false, env = process.env, channel } = {}) {
  const target = otaTarget(root, { channel });
  const gitEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
  const git = args => execFileSync('git', args, { cwd: root, env: gitEnv, encoding: 'utf8' }).trim();
  let baseline;
  try { baseline = JSON.parse(readFileSync(resolve(root, target.baseline_file), 'utf8')); }
  catch { throw new Error(`Missing or invalid verified ${target.channel} iOS binary baseline; verify a new build before OTA`); }
  // EAS submission IDs identify uploads, not Apple build IDs. A completed
  // TestFlight upload can retain an explicitly unknown Apple ID honestly.
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  const appleEvidence = uuid.test(baseline.asc_build_id) ||
    (target.channel === 'testflight' && baseline.asc_build_id === null &&
      uuid.test(baseline.eas_submission_id) && baseline.eas_submission_status === 'FINISHED');
  if (baseline.version !== 1 || baseline.platform !== 'ios' ||
      !/^[a-f0-9]{40}$/.test(baseline.source_sha) || baseline.channel !== target.channel ||
      !uuid.test(baseline.eas_build_id) || !appleEvidence ||
      !/^[a-f0-9]{64}$/.test(baseline.ipa_sha256) || !baseline.runtime_version ||
      !baseline.verified_at || !Number.isFinite(Date.parse(baseline.verified_at)) ||
      !baseline.build_number || !baseline.bundle_id || !baseline.google_ios_client_id)
    throw new Error('Missing or invalid verified iOS binary baseline; a new build must be verified before OTA');
  const fingerprint = baseline.fingerprint;
  if (!fingerprint || !/^[a-f0-9]{40}$/.test(fingerprint.hash) ||
      !/^\d+\.\d+\.\d+$/.test(fingerprint.package_version))
    throw new Error(`Build ${baseline.build_number} has no verified Expo fingerprint; record the actual binary fingerprint before OTA`);
  const head = git(['rev-parse', 'HEAD']);
  git(['merge-base', '--is-ancestor', baseline.source_sha, head]);
  // Expo ignores generated CNG directories. Retain the existing refusal of
  // ignored local native inputs rather than trusting their omission.
  const dirty = git(['status', '--porcelain', '--untracked-files=all', '--ignored', '--',
    'apps/mobile/ios', 'apps/mobile/android', 'patches']);
  if (dirty) throw new Error('Local native inputs are outside the verified source; ship and verify a binary before OTA');
  if (productionEnv && env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID !== baseline.google_ios_client_id)
    throw new Error('Production Google iOS URL scheme differs from the verified binary; OTA cannot register a native scheme');
  // Preliminary checks need only native configuration. Repeat inside EAS's
  // production environment with the actual publish-env guard before export.
  const fingerprintEnv = { ...gitEnv, EXPO_NO_DOTENV: '1',
    NODE_ENV: productionEnv ? 'production' : 'development',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: productionEnv ? env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID : baseline.google_ios_client_id };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'EXPO_TOKEN']) delete fingerprintEnv[key];
  const current = JSON.parse(execFileSync(process.execPath, [resolve(root, 'scripts/deploy/native-fingerprint.mjs')],
    { cwd: root, env: fingerprintEnv, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120000 }));
  if (current.fingerprint.package_version !== fingerprint.package_version)
    throw new Error('Expo fingerprint version differs from the verified binary; verify a new baseline before OTA');
  if (current.fingerprint.hash !== fingerprint.hash)
    throw new Error(`iOS native fingerprint differs from build ${baseline.build_number}; a new build is needed. Ship and verify a binary before OTA`);
  const runtime = current.app.runtime_version;
  const resolvedRuntime = typeof runtime === 'string' ? runtime
    : runtime?.policy === 'fingerprint' ? current.fingerprint.hash
    : runtime?.policy === 'appVersion' ? current.app.version : undefined;
  if (current.app.bundle_id !== baseline.bundle_id || current.app.build_number !== baseline.build_number ||
      resolvedRuntime !== baseline.runtime_version)
    throw new Error('Bundle identity, build number or runtime differs from the verified binary; a new build is needed before OTA');
  return { compatible: true, platform: 'ios', source_sha: head, baseline_source_sha: baseline.source_sha,
    eas_build_id: baseline.eas_build_id, runtime_version: baseline.runtime_version, channel: baseline.channel,
    fingerprint: current.fingerprint.hash, production_env_checked: productionEnv };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  try { console.log(JSON.stringify(checkCompatibility(root, { productionEnv: process.argv.includes('--production-env'),
    channel: process.argv.find(arg => arg.startsWith('--channel='))?.split('=')[1] }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
