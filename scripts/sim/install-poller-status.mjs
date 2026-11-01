#!/usr/bin/env node
// On-demand adoption by the existing Mac owner; never a second poller or schedule.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gitEnv, isMain, repository } from '../verify/impact-plan.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const legacyTailHash = 'd33f893d3ec15a215483dcacc2c24be694e0855e97be83f52398978ba3261271';
const setter = "const setStatus = (sha, s, d) => api(`statuses/${sha}`, 'POST', { state: s, context: CONTEXT, description: d.slice(0, 139) });";
const imported = "import { finishSimulatorAttempt, postSimulatorStatus } from './poller-status.mjs';";
const publish = 'const setStatus = (sha, s, d) => postSimulatorStatus(api, sha, s, d);';
const recovery = `  // Retry publication of an already recorded result without rerunning native work.
  if (!MAIN && st.pendingStatus) {
    finishSimulatorAttempt({ state: st, head: sha, post: setStatus, save });
    continue;
  }
`;
const finish = `  // Maintained Simulator outcome and publication lifecycle.
  const outcome = finishSimulatorAttempt({ state: st, head: sha, scope, error, verdict, env, evidence: ev, post: setStatus, save });
  log(\`#\${pr.number} \${sha} \${outcome.status}: \${outcome.reason}\`);
  if (outcome.retry) continue;
  try {
    comment(pr.number, \`**TL;DR:** Simulator \${outcome.status}: \${outcome.reason}\\n\\nHead: \${sha}\\nScope: \${scope}\\nEvidence on the Mac: \${ev}\\n\` +
      (verdict ? \`\\nSteps:\\n\${(verdict.steps || []).slice(0, 40).map(s => \`- \${s}\`).join('\\n')}\\n\\n\` +
        \`Advisory:\\n\${(verdict.advisory || []).map(s => \`- \${s}\`).join('\\n')}\\n\` +
        \`Proposed new Maestro flows (retained in the evidence directory): \${(verdict.proposed_flows || []).map(f => f.name).join(', ')}\\n\` : ''));
  } catch { log(\`#\${pr.number} Simulator status posted; comment publication failed (retry with retained evidence)\`); }
`;

export function patchPoller(source) {
  if (source.includes(imported) && source.includes(publish) && source.includes(recovery) && source.includes(finish)) return source;
  const anchor = "import { prepareExpiredFixture } from './expired-fixture.mjs';";
  const loop = "  let scope0 = 'full', flows0 = '';";
  const start = source.indexOf('  const failed = error?.gateFail');
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0 || hash(source.slice(start, end)) !== legacyTailHash ||
      source.split(setter).length !== 2 || source.split(anchor).length !== 2 || source.split(loop).length !== 2)
    throw new Error('Host poller contract changed; review its actual caller before installing');
  return (source.slice(0, start) + finish.trimEnd() + source.slice(end))
    .replace(anchor, anchor + '\n' + imported).replace(setter, publish).replace(loop, recovery + loop);
}

export function installPollerStatus(hostDirectory, source = repository) {
  const host = resolve(hostDirectory);
  const git = args => execFileSync('git', args, { cwd: source, env: gitEnv(), encoding: 'utf8' }).trim();
  const head = git(['rev-parse', 'HEAD']);
  if (head !== git(['rev-parse', 'origin/main']) || git(['status', '--porcelain']))
    throw new Error('Install only from a clean reviewed checkout of origin/main after merge');
  const lock = join(host, 'lock');
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Simulator runner busy; install at its existing idle boundary');
    throw error;
  }
  const pid = join(lock, 'pid');
  try {
    // run.sh already honors this PID lock. Own it throughout preparation and
    // replacement so its scheduler cannot enter between an idle check and swap.
    writeFileSync(pid, String(process.pid), { mode: 0o600, flag: 'wx' });
    const target = join(host, 'poller.mjs'), previous = readFileSync(target, 'utf8');
    const patched = patchPoller(previous);
    const module = readFileSync(join(source, 'scripts/sim/poller-status.mjs'), 'utf8');
    const sourceHash = hash(module);
    const bundle = join(host, 'status-modules', `${head}-${sourceHash.slice(0, 12)}`);
    const shim = `// Main ${head}; source hash ${sourceHash}.\nexport * from ${JSON.stringify('./' + relative(host, join(bundle, 'poller-status.mjs')).split('\\').join('/'))};\n`;
    const shimPath = join(host, 'poller-status.mjs');
    if (previous === patched && existsSync(shimPath) && readFileSync(shimPath, 'utf8') === shim &&
        readFileSync(join(bundle, 'poller-status.mjs'), 'utf8') === module) return { head, changed: false };
    mkdirSync(bundle, { recursive: true, mode: 0o700 });
    const snapshot = join(bundle, 'poller-status.mjs');
    if (existsSync(snapshot)) {
      if (readFileSync(snapshot, 'utf8') !== module) throw new Error('Installed status snapshot changed');
    } else writeFileSync(snapshot, module, { mode: 0o444, flag: 'wx' });
    execFileSync(process.execPath, ['--check', '--input-type=module'], { input: patched, encoding: 'utf8' });
    if (git(['rev-parse', 'HEAD']) !== head || git(['status', '--porcelain']) ||
        readFileSync(pid, 'utf8') !== String(process.pid) || readFileSync(target, 'utf8') !== previous)
      throw new Error('Source or host changed during status preparation');
    const history = join(host, 'status-installations'); mkdirSync(history, { recursive: true, mode: 0o700 });
    const id = `${Date.now()}-${process.pid}`, backup = join(history, `${id}.previous.mjs`);
    writeFileSync(backup, previous, { mode: 0o600, flag: 'wx' });
    const temporary = join(host, `.poller-status-${id}.tmp`), shimTemporary = temporary + '.shim';
    writeFileSync(shimTemporary, shim, { mode: 0o600, flag: 'wx' });
    writeFileSync(temporary, patched, { mode: 0o600, flag: 'wx' });
    renameSync(shimTemporary, shimPath); renameSync(temporary, target);
    const receipt = { head, sourceHash, target, backup, changed: true, previousHash: hash(previous),
      installedHash: hash(patched), installedAt: new Date().toISOString(), requiresNewProcess: true };
    writeFileSync(join(history, `${id}.json`), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return receipt;
  } finally {
    if (existsSync(pid) && readFileSync(pid, 'utf8') === String(process.pid)) { unlinkSync(pid); rmdirSync(lock); }
    else if (!existsSync(pid)) rmdirSync(lock);
  }
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: install-poller-status.mjs <existing-sim-review-directory>');
    console.log(JSON.stringify(installPollerStatus(process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
