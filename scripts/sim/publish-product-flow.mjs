#!/usr/bin/env node
// Publish an exact-head local verdict; no simulator or credential executes in CI.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { root, inputHash, impact, changedPaths, validate, repoEnv } from '../verify/product-flow.mjs';
import { publicationArtifacts } from './publication-artifacts.mjs';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', env: repoEnv(), maxBuffer: 16 * 1024 * 1024, ...opts })?.trim() || '';
const gh = args => run('gh', args);
const assert = (ok, why) => { if (!ok) throw new Error(why); };
async function fileDigest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const repo = 'dgmolla/fitsy', context = 'product-flow/local';
let head;
function status(state, description, target_url) {
  return run('gh', ['api', `repos/${repo}/statuses/${head}`, '--input', '-'], { input: JSON.stringify({ state, context, description, target_url }) });
}
try {
  const prNumber = process.argv[2];
  assert(/^\d+$/.test(prNumber || ''), 'Usage: node scripts/sim/publish-product-flow.mjs PR_NUMBER');
  const pr = JSON.parse(gh(['pr', 'view', prNumber, '--repo', repo, '--json', 'headRefOid,baseRefName,headRepositoryOwner,state,url']));
  assert(pr.state === 'OPEN' && pr.baseRefName === 'main' && pr.headRepositoryOwner.login === 'dgmolla', 'Expected an open same-repository PR to main');
  const candidate = run('git', ['rev-parse', 'HEAD']);
  assert(pr.headRefOid === candidate, 'Local HEAD does not match the remote PR');
  head = candidate;
  status('pending', 'Validating local candidate evidence', pr.url);
  assert(!run('git', ['status', '--porcelain']), 'Commit all candidate inputs before publishing evidence');
  run('git', ['fetch', 'origin', 'main']);
  run('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  const plan = impact(changedPaths('origin/main'));
  let target = pr.url;
  if (plan.required || process.argv.includes('--include-baseline')) {
    const dir = resolve(root, '.evidence/product-flow'), reportFile = resolve(dir, 'report.json');
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    validate(report, plan, inputHash(), dir);
    run(process.execPath, ['--env-file=apps/mobile/.env.development.local', 'scripts/sim/product-flow.mjs', 'check']);
    const tag = `product-flow-${head}`;
    const artifacts = publicationArtifacts(report, plan.categories);
    mkdirSync(resolve(root, '.evidence/publication'), { recursive: true });
    const archive = resolve(root, '.evidence/publication/local-evidence.tar.gz');
    // Only verified relative artifact paths; no build, environment or debug logs.
    for (const f of artifacts) assert(!f.startsWith('-') && !f.startsWith('/') && !f.split('/').includes('..'), 'Invalid archive path');
    run('tar', ['-czf', archive, '-C', dir, ...artifacts]);
    const archiveEntries = run('tar', ['-tzf', archive]).split('\n');
    assert(archiveEntries.length === artifacts.length && artifacts.every(file => archiveEntries.includes(file)), 'Published archive omits verified evidence');
    const archiveSize = statSync(archive).size;
    assert(archiveSize > 0 && archiveSize < 2 * 1024 ** 3, 'Evidence archive exceeds the GitHub release asset limit of under 2 GiB');
    const archiveDigest = `sha256:${await fileDigest(archive)}`;
    const notes = resolve(root, '.evidence/publication/notes.md');
    writeFileSync(notes, `Local simulator evidence for ${pr.url}\n\nCandidate: ${head}\nSource/test hash: ${report.inputHash}\nFinished: ${report.finishedAt}\nStore: ${report.storeMode}\n\nPrivate draft for repository reviewers; do not publish. Includes Maestro commands, complete flow videos, screenshots and changed-journey observations.\n`);
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
    assert(report.inputHash === inputHash() && !run('git', ['status', '--porcelain']), 'Candidate changed during publication');
  }
  const latest = JSON.parse(gh(['pr', 'view', prNumber, '--repo', repo, '--json', 'headRefOid']));
  assert(latest.headRefOid === head, 'PR head changed during publication');
  status('success', plan.required ? 'Local Maestro and changed-journey evidence verified' : 'Not applicable: no mobile-facing product changes', target);
  console.log(JSON.stringify({ status: 'pass', context, head, applicability: plan.required ? 'required' : 'not_applicable', url: target }));
} catch (e) {
  if (head) { try { status('failure', 'Local evidence failed; inspect publisher output'); } catch { /* preserve original failure */ } }
  console.error(e.message); process.exitCode = 1;
}
