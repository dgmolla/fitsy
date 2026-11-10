#!/usr/bin/env node
// Publish an exact-head local verdict; no simulator or credential executes in CI.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync, lstatSync, createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, inputHash, impact, changedPaths, validateAcceptance, baseline, repoEnv, publicConfigIdentity, requiredPublicConfigKeys, selectedFlows } from '../verify/product-flow.mjs';
import { journeyFixture } from './journey-fixtures.mjs';
import { validateMediaReceipt } from '../verify/media-integration.mjs';
import { publicationArtifacts } from './publication-artifacts.mjs';
import { readPreviousReportForReuse } from './evidence-mode.mjs';
import { comparison, isMain, simulatorContext } from '../verify/impact-plan.mjs';
const yaml = createRequire(import.meta.url)('js-yaml');
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
const billingFixtureNames = new Set(['empty-store', 'expired-subscription', 'entitled-dev']);
// The billing walkthrough category defaults to the empty-store persona, with
// the same empty env override as prepareWalkthrough's own 'default' journey,
// when no changed-journey flow overrides it (see product-flow.mjs).
export function requiredBillingFixtures(plan) {
  const fixtures = new Map(plan.categories?.includes('billing') ? [['empty-store', {}]] : []);
  for (const name of selectedFlows(plan)) {
    const source = readFileSync(resolve(root, 'apps/mobile/e2e/flows', `${name}.yaml`), 'utf8');
    const tags = yaml.load(source.split(/^---\s*$/m)[0]).tags || [];
    // Only resolve (and require FITSY_E2E_FIXTURES for) a fixture this check
    // actually cares about; an unrelated persona's own config stays optional.
    const fixtureName = tags.filter(tag => tag.startsWith('fixture:')).map(tag => tag.slice(8))[0];
    if (billingFixtureNames.has(fixtureName)) fixtures.set(fixtureName, journeyFixture({ tags }).env);
  }
  return [...fixtures.entries()].map(([name, env]) => ({ name, env })).sort((a, b) => a.name.localeCompare(b.name));
}
export function publicationPlan(evidenceDirectory, buildReceiptFile, paths = changedPaths('origin/main'), current = publicConfigIdentity(), options = {}) {
  const { recoverHistoricalReport = false, ...impactOptions } = options;
  const readReceipt = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const reportFile = resolve(evidenceDirectory, 'report.json');
  const previous = recoverHistoricalReport && existsSync(reportFile)
    ? readPreviousReportForReuse(reportFile) : { report: readReceipt(reportFile) };
  const build = readReceipt(buildReceiptFile);
  const keys = requiredPublicConfigKeys(previous.report, build, current);
  if (previous.error) keys.push('<unknown>');
  const plan = impact(paths, [...new Set(keys)].sort(), {
    ...simulatorContext(process.env), ...impactOptions,
    comparison: comparison({ cwd: root, base: 'origin/main' }),
  });
  return previous.error ? { ...plan,
    historyWarning: 'Preserve unreadable historical evidence in the existing archive before fresh conservative collection' } : plan;
}
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
  preflight = false,
  execute = run,
  evidenceDirectory = resolve(root, '.evidence/product-flow'),
  buildReceiptFile = resolve(root, '.evidence/product-build/receipt.json'),
  publicationDirectory = resolve(root, '.evidence/publication'),
  resolvePlan = options => publicationPlan(evidenceDirectory, buildReceiptFile, undefined, undefined, options),
  sourceHash = inputHash,
  validateEvidence = validateAcceptance,
  validateMediaEvidence = candidate => validateMediaReceipt(changedPaths('origin/main'), candidate, sourceHash()),
} = {}) {
  if (preflight) {
    const invoke = execute;
    execute = (command, args, options = {}) => invoke(command, args, { ...options, timeout: 30000 });
    // Exercise the same child environment used by the final checker before
    // collecting native evidence. Never print environment values or stderr.
    let config;
    try {
      config = JSON.parse(execute(process.execPath, ['--env-file=apps/mobile/.env.development.local', '--input-type=module', '-e',
        `import {environment} from ${JSON.stringify(new URL('./product-flow.mjs', import.meta.url).href)}; console.log(JSON.stringify({configHash:environment().configHash}));`],
      { stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch {
      throw new Error('Final checker cannot load the canonical mobile environment; run npm run dev:env against the existing fitsy-api project and verify development configuration before final collection');
    }
    assert(config?.configHash === publicConfigIdentity().configHash, 'Final checker configuration differs from the collection configuration');
  }
  const gh = args => execute('gh', args);
  let head;
  function status(state, description, target_url) {
    return execute('gh', ['api', `repos/${repo}/statuses/${head}`, '--input', '-'], { input: JSON.stringify({ state, context, description, target_url }) });
  }
  try {
  assert(/^\d+$/.test(prNumber || '') || (preflight && prNumber === undefined),
    'Usage: node scripts/sim/publish-product-flow.mjs PR_NUMBER [--preflight]');
  const selector = prNumber ?? execute('git', ['branch', '--show-current']);
  assert(selector && !selector.startsWith('-'), 'Automatic final preflight requires an owned branch or explicit PR number');
  const pr = JSON.parse(gh(['pr', 'view', selector, '--repo', repo, '--json', 'headRefOid,baseRefName,headRepositoryOwner,state,url,labels']));
  assert(pr.state === 'OPEN' && pr.baseRefName === 'main' && pr.headRepositoryOwner.login === 'dgmolla', 'Expected an open same-repository PR to main');
  const candidate = execute('git', ['rev-parse', 'HEAD']);
  assert(pr.headRefOid === candidate, 'Local HEAD does not match the remote PR');
  head = candidate;
  if (!preflight) status('pending', 'Validating local candidate evidence', pr.url);
  assert(!execute('git', ['status', '--porcelain']), 'Commit all candidate inputs before publishing evidence');
  if (process.env.FITSY_PRODUCT_ROOT) {
    // A live externally admitted frozen comparison may use newer trusted
    // controls. Do not mutate its comparison ref or its source-bound receipts.
    const controls = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const trusted = run('git', ['rev-parse', 'HEAD'], { cwd: controls });
    assert(trusted === run('git', ['rev-parse', 'origin/main'], { cwd: controls }), 'Publisher controls must be exact main');
    assert(!run('git', ['status', '--porcelain'], { cwd: controls }), 'Publisher controls must be clean');
    assert(execute('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] === trusted, 'Trusted main advanced; revalidate frozen comparison');
  } else {
    if (preflight) assert(execute('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] ===
      execute('git', ['rev-parse', 'origin/main']), 'Main advanced; fetch and update the candidate before final collection');
    else execute('git', ['fetch', 'origin', 'main']);
    execute('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
  }
  const media = validateMediaEvidence(candidate);
  const resolved = resolvePlan({ labels: (pr.labels || []).map(label => label.name), recoverHistoricalReport: preflight }),
    includeBaseline = process.argv.includes('--include-baseline');
  const plan = includeBaseline ? { ...resolved, flows: [...new Set([...(resolved.flows || []), ...baseline])].sort(), baseline } : resolved;
  const evidenceRequired = plan.required || includeBaseline;
  if (preflight && evidenceRequired) {
    const fixtures = requiredBillingFixtures(plan);
    if (fixtures.length) {
      let results;
      try {
        results = JSON.parse(execute(process.execPath, ['--env-file=apps/mobile/.env.development.local', '--input-type=module', '-e',
          `import {verifyInactiveEntitlement, verifyRemainingLifetime} from ${JSON.stringify(new URL('./active-entitlement.mjs', import.meta.url).href)};
const built = {storeMode:'test-store', configuration:'Debug', buildMode:'owned-metro-test-store'};
const out = {};
for (const {name, env: override} of ${JSON.stringify(fixtures)}) {
  const env = { ...process.env, ...override };
  try { out[name] = { ok: true, ...(name === 'entitled-dev' ? await verifyRemainingLifetime({ built, env }) : await verifyInactiveEntitlement({ fixture: name, built, env })) }; }
  catch (e) { out[name] = { ok: false, reason: e.message }; }
}
console.log(JSON.stringify(out));`],
        { stdio: ['ignore', 'pipe', 'pipe'] }));
      } catch (e) {
        throw new Error(`Billing persona preflight could not run: ${e.message}`);
      }
      const failed = Object.entries(results).filter(([, r]) => !r.ok);
      assert(!failed.length, `Billing persona preflight failed: ${failed.map(([fixture, r]) => `${fixture}: ${r.reason}`).join('; ')}`);
    }
  }
  if (preflight) return { status: 'ready', head, plan, mediaIntegration: media?.required ? 'required' : 'not_applicable',
    evidenceRequired, report: '.evidence/product-flow/report.json',
    requiredProof: evidenceRequired ? ['final-candidate report with source/app/native/JS/config/backend/store/runtime identities',
      'selected-flow commands, screenshots and real before/after XCTest closeouts',
      'actual primary/recovery MCP traces for each selected category',
      'final check and private archive byte/digest readback'] : [],
    note: 'Preflight is not product acceptance or evidence reuse; final validation and publication remain required' };
  let target = pr.url;
  if (evidenceRequired) {
    const dir = evidenceDirectory, reportFile = resolve(dir, 'report.json');
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    assert(report.evidenceMode === 'final-candidate',
      'Final candidate proof is required; rerun with --mode=final-candidate');
    await validateEvidence(report, plan, sourceHash(), dir);
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
    const exceptions = (report.exceptions || []).map(item =>
      `${item.flow}: ${item.status}, never passed; ${item.reason}; source ${item.source}; owner ${item.approval}.`).join('\n');
    writeFileSync(notes, `**TL;DR:** Verified local simulator evidence is preserved for ${pr.url}.\n\nCandidate: ${head}\nSource/test hash: ${report.inputHash}\nFinished: ${report.finishedAt}\nStore: ${report.storeMode}\n${exceptions ? `\n${exceptions}\n` : ''}\nPrivate draft for repository reviewers; do not publish.\nIncludes Maestro commands, screenshots and changed-journey observations${recorded ? ', plus complete untrimmed flow videos' : ''}.\n`);
    let release;
    try { release = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,url'])); } catch { /* create below */ }
    assert(!release || release.isDraft, 'Evidence release must remain a private draft');
    if (!release) gh(['release', 'create', tag, '--repo', repo, '--draft', '--target', head, '--title', `Local product evidence ${head.slice(0, 8)}`, '--notes-file', notes]);
    gh(['release', 'upload', tag, archive, '--repo', repo, '--clobber']);
    // GitHub's releases/tags endpoint returns 404 for drafts, even to their owner.
    const published = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,url,assets']));
    const uploaded = published.assets?.find(asset => asset.name === 'local-evidence.tar.gz');
    assert(published.isDraft && uploaded?.state === 'uploaded' && uploaded.size === archiveSize && uploaded.digest === archiveDigest,
      'Draft evidence asset digest/size readback did not match the local archive');
    target = published.url;
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
  if (head && !preflight) { try { status('failure', 'Local evidence failed; inspect publisher output'); } catch { /* preserve original failure */ } }
  throw e;
  }
}
if (isMain(import.meta.url)) {
  try {
    const flags = process.argv.slice(3);
    assert(process.argv[2] && new Set(flags).size === flags.length &&
      flags.every(flag => ['--preflight', '--include-baseline'].includes(flag)),
    'Usage: node scripts/sim/publish-product-flow.mjs PR_NUMBER [--preflight] [--include-baseline]');
    console.log(JSON.stringify(await publishProductFlow(process.argv[2], { preflight: flags.includes('--preflight') })));
  } catch (e) {
    console.error(e.message); process.exitCode = 1;
  }
}
