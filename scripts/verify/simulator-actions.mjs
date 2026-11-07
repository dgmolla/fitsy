#!/usr/bin/env node
// Actions' deliberately small smoke policy is separate from manual acceptance.
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { changedFiles, isMain } from './impact-plan.mjs';

export function actionsSelection(files, eventName, event) {
  if (!Array.isArray(files)) throw new Error('Cannot resolve simulator comparison; refusing a passing skip');
  const required = files.some(path => /^(apps\/mobile\/|scripts\/(sim|verify)\/|scripts\/deploy\/native-fingerprint\.mjs$|\.github\/workflows\/simulator\.yml$)/.test(path));
  const full = eventName === 'push' || event.pull_request?.labels?.some(label => label.name === 'full-sim');
  return { required, scope: required ? (full ? 'full' : 'smoke') : 'none' };
}

// Local watch/setup diagnostic, not an Actions token or a new merge gate.
async function runnerPreflight() {
  const { default: yaml } = await import('js-yaml');
  const labels = yaml.load(readFileSync(new URL('../../.github/workflows/simulator.yml', import.meta.url), 'utf8')).jobs.mac['runs-on'];
  if (!Array.isArray(labels) || !labels.length || labels.some(label => typeof label !== 'string'))
    throw new Error('Cannot resolve Maestro on Mac runner labels');
  let raw;
  try {
    raw = execFileSync('gh', ['api', '--paginate', '--slurp', 'repos/dgmolla/fitsy/actions/runners?per_page=100'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  } catch {
    // gh errors can contain private response data. Denial is not empty capacity.
    throw new Error('Runner inventory unavailable; check existing gh authentication and repository Administration read permission');
  }
  let pages;
  try { pages = JSON.parse(raw); } catch { /* rejected below */ }
  const valid = Array.isArray(pages) && pages.length > 0 && pages.every(page =>
    Number.isInteger(page?.total_count) && page.total_count >= 0 && Array.isArray(page.runners));
  const runners = valid ? pages.flatMap(page => page.runners) : [];
  if (!valid || pages.some(page => page.total_count !== runners.length) ||
      new Set(runners.map(runner => runner?.id)).size !== runners.length || runners.some(runner =>
        !Number.isInteger(runner?.id) || !['online', 'offline'].includes(runner.status) || typeof runner.busy !== 'boolean' ||
        !Array.isArray(runner.labels) || runner.labels.some(label => typeof label?.name !== 'string')))
    throw new Error('Runner inventory is incomplete or invalid; capacity remains unknown');
  const matching = runners.filter(runner => labels.every(label =>
    runner.labels.some(actual => actual.name.toLowerCase() === label.toLowerCase())));
  const online = matching.filter(runner => runner.status === 'online');
  const counts = `registered=${runners.length} matching=${matching.length} online=${online.length} busy=${online.filter(runner => runner.busy).length}`;
  if (!online.length) throw new Error(`No online runner matches [${labels.join(', ')}]: ${counts}; owner must resolve runner provisioning before hosted native execution`);
  console.log(`Simulator runner capacity: ${counts}; online busy runners retain the serialized queue`);
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--preflight') await runnerPreflight();
    else {
      if (process.argv.length !== 2) throw new Error('Usage: simulator-actions.mjs [--preflight]');
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      const selection = actionsSelection(changedFiles().files, process.env.GITHUB_EVENT_NAME, event);
      for (const [key, value] of Object.entries(selection)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
      console.log(`Simulator: ${selection.scope}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
