#!/usr/bin/env node
// Hosted execution consumes the same source impact as local/final acceptance.
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { changedFiles, isMain, simulatorSelection } from './impact-plan.mjs';

export function actionsSelection(files, eventName, event, options = {}) {
  if (!Array.isArray(files)) throw new Error('Cannot resolve simulator comparison; refusing a passing skip');
  if (!['pull_request', 'push'].includes(eventName)) throw new Error('Cannot resolve simulator event context');
  const labels = (event.pull_request?.labels || []).map(label => label.name);
  const plan = simulatorSelection(files, { ...options, labels, release: labels.includes('full-sim') });
  if (plan.required) return { required: true, scope: plan.scope === 'full' ? 'full' : 'flow', flows: plan.flows, reason: plan.reason };
  // A changed native runner still needs real execution of its setup, assertion
  // and teardown path. It does not change every product journey on main.
  const controls = files.some(path => /^(scripts\/(sim|verify)\/|\.github\/workflows\/simulator\.yml$)/.test(path) &&
    !/\.(?:test\.[^/]+|md|txt)$/.test(path));
  return { required: controls, scope: controls ? 'smoke' : 'none', flows: [],
    reason: controls ? 'Changed simulator controls require the three maintained hosted smoke journeys' : plan.reason };
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
      const { files, comparison } = changedFiles();
      const selection = actionsSelection(files, process.env.GITHUB_EVENT_NAME, event, { comparison });
      for (const key of ['required', 'scope']) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${selection[key]}\n`);
      console.log(`Simulator: ${JSON.stringify(selection)}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
