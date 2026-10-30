#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function otaTarget(root, { channel, manualProduction = false, env = process.env } = {}) {
  const policy = JSON.parse(readFileSync(resolve(root, 'scripts/deploy/ota-policy.json'), 'utf8'));
  if (policy.version !== 1 || typeof policy.app_store_launched !== 'boolean' ||
      !['production', 'testflight'].includes(policy.automatic_channel) ||
      (policy.app_store_launched && policy.automatic_channel !== 'testflight'))
    throw new Error('Invalid OTA channel policy; App Store production OTA must be manual');
  if (manualProduction) {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' ||
        env.GITHUB_REPOSITORY !== 'dgmolla/fitsy' ||
        env.GITHUB_ACTOR !== 'dgmolla' || ![true, 'true'].includes(event.inputs?.approve_production_ota))
      throw new Error('Production OTA requires Dawit\'s explicit main workflow dispatch approval');
    channel = 'production';
  }
  channel ??= policy.automatic_channel;
  if (!['production', 'testflight'].includes(channel)) throw new Error('Unsupported OTA channel');
  return { channel, baseline_file: channel === 'production'
    ? 'scripts/deploy/ios-binary-baseline.json' : 'scripts/deploy/ios-testflight-binary-baseline.json' };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(otaTarget(resolve(fileURLToPath(new URL('../..', import.meta.url))),
    { manualProduction: process.argv.includes('--manual-production') }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
