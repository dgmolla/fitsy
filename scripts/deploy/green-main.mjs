#!/usr/bin/env node
// Gate 3 (#931): which commits on main passed the full suite? The Main full suite workflow posts the non-required commit
// status `full-suite/green`; releases are cut only from a commit where it is success.
//   node scripts/deploy/green-main.mjs --latest        print the newest green main commit
//   node scripts/deploy/green-main.mjs --check <sha>   exit 0 only if that exact commit is green
import { execFileSync } from 'node:child_process';

const repo = 'dgmolla/fitsy';
const context = 'full-suite/green';
const gh = args => execFileSync('gh', ['api', ...args], { encoding: 'utf8' });

function greenState(sha) {
  const { statuses } = JSON.parse(gh([`repos/${repo}/commits/${sha}/status`]));
  return statuses.find(status => status.context === context)?.state ?? 'missing';
}

function main(argv) {
  if (argv[0] === '--check' && /^[0-9a-f]{40}$/.test(argv[1] ?? '')) {
    const state = greenState(argv[1]);
    console.log(JSON.stringify({ sha: argv[1], state }));
    return state === 'success' ? 0 : 1;
  }
  if (argv[0] === '--latest' && argv.length === 1) {
    for (const sha of gh([`repos/${repo}/commits?sha=main&per_page=30`, '--jq', '.[].sha']).split('\n').filter(Boolean)) {
      if (greenState(sha) === 'success') { console.log(sha); return 0; }
    }
    console.error('No green main commit in the newest 30 commits');
    return 1;
  }
  console.error('Usage: green-main.mjs --latest | --check <40-char sha>');
  return 2;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (error) { console.error(`green-main failed: ${error.message}`); process.exitCode = 2; }
