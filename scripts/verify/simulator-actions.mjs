#!/usr/bin/env node
// Actions' deliberately small smoke policy is separate from manual acceptance.
import { appendFileSync, readFileSync } from 'node:fs';
import { changedFiles, isMain } from './impact-plan.mjs';

export function actionsSelection(files, eventName, event) {
  if (!Array.isArray(files)) throw new Error('Cannot resolve simulator comparison; refusing a passing skip');
  const required = files.some(path => /^(apps\/mobile\/|scripts\/(sim|verify)\/|scripts\/deploy\/native-fingerprint\.mjs$|\.github\/workflows\/simulator\.yml$)/.test(path));
  const full = eventName === 'push' || event.pull_request?.labels?.some(label => label.name === 'full-sim');
  return { required, scope: required ? (full ? 'full' : 'smoke') : 'none' };
}

if (isMain(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const selection = actionsSelection(changedFiles().files, process.env.GITHUB_EVENT_NAME, event);
  for (const [key, value] of Object.entries(selection)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(`Simulator: ${selection.scope}`);
}
