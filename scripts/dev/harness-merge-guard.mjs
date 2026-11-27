#!/usr/bin/env node
// #1101: a harness merge to main must not silently stale a product PR's in-flight native run. Before merging a PR, run
//   node scripts/dev/harness-merge-guard.mjs <PR number>
// It exits 1 (hold the merge) when the PR changes files that alter how native journeys run (simulatorSelection scope other than
// 'none', the same rule publish uses to accept a base update) while a native run is in flight on this Mac. Exit 0 otherwise.
// In flight = the shared simulator lock is held, or a product-flow collector process is running.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulatorSelection } from '../verify/impact-plan.mjs';

const repo = 'dgmolla/fitsy';
const sh = (cmd, options = {}) => execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options });

export function nativeRunInFlight({ lockPath = resolve(homedir(), 'fitsy-wt/simulator.lock'), exec = sh } = {}) {
  if (existsSync(lockPath)) return `simulator lock held (${lockPath})`;
  try {
    const found = exec(['pgrep', '-fl', 'scripts/(sim|verify)/product-flow\\.mjs']).trim();
    if (found) return `product-flow collector running: ${found.split('\n')[0]}`;
  } catch { /* pgrep exits 1 when nothing matches */ }
  return null;
}

// Pure: the decision, given the PR's changed files and the in-flight reason (or null).
export function decide(files, inFlight, selection = simulatorSelection) {
  const scope = selection(files).scope;
  if (scope === 'none') return { hold: false, reason: 'no journey-affecting files' };
  if (!inFlight) return { hold: false, reason: `scope ${scope}, no native run in flight` };
  return { hold: true, reason: `changes journey-affecting files (scope ${scope}) while a native run is in flight: ${inFlight}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pr = process.argv[2];
  if (!/^[1-9]\d*$/.test(String(pr))) { console.error('usage: harness-merge-guard.mjs <PR number>'); process.exit(2); }
  const files = JSON.parse(sh(['gh', 'pr', 'view', pr, '--repo', repo, '--json', 'files'])).files.map(file => file.path);
  const result = decide(files, nativeRunInFlight());
  console.log(`${result.hold ? 'HOLD' : 'OK'}: PR #${pr} ${result.reason}`);
  process.exit(result.hold ? 1 : 0);
}
