#!/usr/bin/env node
// Publish an exact-head local verdict; no simulator or credential executes in CI.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync, lstatSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, inputHash, impact, changedPaths, validate, repoEnv } from '../verify/product-flow.mjs';
import { validateMediaReceipt } from '../verify/media-integration.mjs';
import { publicationArtifacts } from './publication-artifacts.mjs';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', env: repoEnv(), maxBuffer: 16 * 1024 * 1024, ...opts })?.trim() || '';
const assert = (ok, why) => { if (!ok) throw new Error(why); };
async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function archivedDigest(archive, file) {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256');
    const child = spawn('tar', ['-xOf', archive, file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stdout.on('data', chunk => hash.update(chunk));
    child.stderr.on('data', chunk => { error += chunk.toString().slice(0, 1024); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveDigest(hash.digest('hex')) : reject(new Error(`Cannot extract ${file} from evidence archive: ${error}`)));
  });
}
const repo = 'dgmolla/fitsy', context = 'product-flow/local';
export async function createPublicationArchive(report, categories, dir, archive, execute = run) {
  const artifacts = publicationArtifacts(report, categories);
  // Only verified relative artifact paths; no build, environment or debug logs.
  assert(lstatSync(dir).isDirectory(), 'Evidence directory must be a real directory');
  for (const f of artifacts) {
    const parts = f.split('/');
    assert(!f.startsWith('-') && !f.startsWith('/') && parts.every(part => part && part !== '..' && part !== '.'), 'Invalid archive path');
    for (let index = 0; index < parts.length; index++) {
      const entry = lstatSync(resolve(dir, ...parts.slice(0, index + 1)));
      assert(index === parts.length - 1 ? entry.isFile() : entry.isDirectory(),
        `Published artifact must be a regular file with real parent directories: ${f}`);
    }
  }
  execute('tar', ['-czf', archive, '-C', dir, ...artifacts]);
  const archiveEntries = execute('tar', ['-tzf', archive]).split('\n');
  assert(archiveEntries.length === artifacts.length && artifacts.every(file => archiveEntries.includes(file)), 'Published archive omits verified evidence');
  for (const file of artifacts) {
    assert(await archivedDigest(archive, file) === await fileDigest(resolve(dir, file)),
      `Published archive has incomplete or changed bytes: ${file}`);
  }
}
export async function publishProductFlow(prNumber, {
  execute = run,
  evidenceDirectory = resolve(root, '.evidence/product-flow'),
  publicationDirectory = resolve(root, '.evidence/publication'),
  resolvePlan = () => impact(changedPaths('origin/main')),
  sourceHash = inputHash,
  validateEvidence = validate,
  validateMediaEvidence = candidate => validateMediaReceipt(changedPaths('origin/main'), candidate, sourceHash()),
} = {}) {
  const gh = args => execute('gh', args);
  let head;
  function status(state, description, target_url) {
    return execute('gh', ['api', `repos/${repo}/statuses/${head}`, '--input', '-'], { input: JSON.stringify({ state, context, description, target_url }) });
  }
  try {
  assert(/^\d+$/.test(prNumber || ''), 'Usage: node scripts/sim/publish-product-flow.mjs PR_NUMBER');
  const pr = JSON.parse(gh(['pr', 'view', prNumber, '--repo', repo, '--json', 'headRefOid,baseRefName,headRepositoryOwner,state,url']));
  assert(pr.state === 'OPEN' && pr.baseRefName === 'main' && pr.headRepositoryOwner.login === 'dgmolla', 'Expected an open same-repository PR to main');
  const candidate = execute('git', ['rev-parse', 'HEAD']);
  assert(pr.headRefOid === candidate, 'Local HEAD does not match the remote PR');
  head = candidate;
  status('pending', 'Validating local candidate evidence', pr.url);
  assert(!execute('git', ['status', '--porcelain']), 'Commit all candidate inputs before publishing evidence');
  execute('git', ['fetch', 'origin', 'main']);
  execute('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  const media = validateMediaEvidence(candidate);
  const plan = resolvePlan();
  const evidenceRequired = plan.required || process.argv.includes('--include-baseline');
  let target = pr.url;
  if (evidenceRequired) {
    const dir = evidenceDirectory, reportFile = resolve(dir, 'report.json');
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    assert(report.evidenceMode === 'final-candidate',
      'Final candidate proof is required; rerun with --mode=final-candidate');
    validateEvidence(report, plan, sourceHash(), dir);
    execute(process.execPath, ['--env-file=apps/mobile/.env.development.local', 'scripts/sim/product-flow.mjs', 'check']);
    const tag = `product-flow-${head}`;
    mkdirSync(publicationDirectory, { recursive: true });
    const archive = resolve(publicationDirectory, 'local-evidence.tar.gz');
    await createPublicationArchive(report, plan.categories, dir, archive, execute);
    const archiveSize = statSync(archive).size;
    assert(archiveSize > 0 && archiveSize < 2 * 1024 ** 3, 'Evidence archive exceeds the GitHub release asset limit of under 2 GiB');
    const archiveDigest = `sha256:${await fileDigest(archive)}`;
    const notes = resolve(publicationDirectory, 'notes.md');
    const recorded = report.videoRequested ?? report.flows.every(flow => Boolean(flow.video && flow.videoHash));
    writeFileSync(notes, `Local simulator evidence for ${pr.url}\n\nCandidate: ${head}\nSource/test hash: ${report.inputHash}\nFinished: ${report.finishedAt}\nStore: ${report.storeMode}\n\nPrivate draft for repository reviewers; do not publish. Includes Maestro commands, screenshots and changed-journey observations${recorded ? ', plus complete untrimmed flow videos' : ''}.\n`);
    let release;
    try { release = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,url'])); } catch { /* create below */ }
    assert(!release || release.isDraft, 'Evidence release must remain a private draft');
    if (!release) gh(['release', 'create', tag, '--repo', repo, '--draft', '--target', head, '--title', `Local product evidence ${head.slice(0, 8)}`, '--notes-file', notes]);
    gh(['release', 'upload', tag, archive, '--repo', repo, '--clobber']);
    const published = JSON.parse(gh(['api', `repos/${repo}/releases/tags/${tag}`]));
    const uploaded = published.assets?.find(asset => asset.name === 'local-evidence.tar.gz');
    assert(published.draft && uploaded?.state === 'uploaded' && uploaded.size === archiveSize && uploaded.digest === archiveDigest,
      'Draft evidence asset digest/size readback did not match the local archive');
    target = published.html_url;
    assert(report.inputHash === sourceHash() && !execute('git', ['status', '--porcelain']), 'Candidate changed during publication');
  }
  const latest = JSON.parse(gh(['pr', 'view', prNumber, '--repo', repo, '--json', 'headRefOid']));
  assert(latest.headRefOid === head, 'PR head changed during publication');
  status('success', evidenceRequired ? 'Local Maestro and required product evidence verified' :
    media?.required ? 'Local media integration verified; product flow not applicable' :
      'Not applicable: no mobile-facing product changes', target);
  return { status: 'pass', context, head, applicability: evidenceRequired ? 'required' : 'not_applicable',
    mediaIntegration: media?.required ? 'required' : 'not_applicable', url: target };
  } catch (e) {
  if (head) { try { status('failure', 'Local evidence failed; inspect publisher output'); } catch { /* preserve original failure */ } }
  throw e;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await publishProductFlow(process.argv[2])));
  } catch (e) {
    console.error(e.message); process.exitCode = 1;
  }
}
