#!/usr/bin/env node
// Local simulator evidence is mandatory; CI does not execute a simulator.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const yaml = createRequire(import.meta.url)('js-yaml');

export const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// Explicit worktree identity must win over a surrounding Git hook's pointers.
export const repoEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', env: repoEnv() }).trim();
export const digest = value => createHash('sha256').update(value).digest('hex');
export const baseline = ['cold-start-welcome', 'signin-options'];
const rules = [
  // Include the screens/routes that apply entitlement guards, not just their helpers.
  ['billing', /^(apps\/mobile\/(.*(payment|paywall|Paywall|purchase|Purchase|entitlement|Entitlement|resubscribe|trial|teaserGate|LockedUnlock)|app\/(welcome\/notification|_layout|index|\(tabs\)\/|restaurant\/|auth\/reviewer)|lib\/(reviewAccess|authClient))|apps\/api\/(app\/api\/(revenuecat|subscriptions|restaurants)|lib\/subscription|services\/revenuecat))/],
  ['notifications', /^(apps\/mobile\/.*([Nn]otification|push)|apps\/api\/.*([Nn]otification|push-token|launchPush|trialReminder))/],
  ['auth', /^(apps\/mobile\/(app\/auth|lib\/.*([Aa]uth|[Ss]ession|supabase))|apps\/api\/(app\/api\/auth|lib\/auth))/],
  ['onboarding', /^apps\/mobile\/(app\/welcome\/|components\/Welcome|lib\/(onboarding|macroCalculator))/],
  ['discovery', /^(apps\/mobile\/app\/\(tabs\)|apps\/mobile\/app\/restaurant|apps\/api\/app\/api\/(restaurants|search|user)|packages\/shared\/src\/)/],
];
// The health response serves deployment monitors and is verified over HTTP.
const serviceHealthPath = path => /^apps\/api\/app\/api\/health\/route(?:\.test)?\.ts$/.test(path);

export function impact(paths) {
  const source = paths.filter(p => !/\.md$/.test(p));
  const affected = source.filter(p => /^(apps\/mobile\/|packages\/shared\/|apps\/api\/(app\/api\/|lib\/|services\/|[^/]+$)|prisma\/|package(-lock)?\.json$)/.test(p) && !serviceHealthPath(p));
  const categories = new Set();
  for (const path of affected) {
    const matched = rules.filter(([, pattern]) => pattern.test(path));
    for (const [category] of matched) categories.add(category);
    // Unknown client/config/schema changes need a changed-journey charter too.
    if (!matched.length) categories.add('changed-journey');
  }
  return { required: affected.length > 0, paths: affected, categories: [...categories].sort(), baseline };
}

export function changedPaths(base, cwd = root) {
  // Explicit CI base avoids origin/main...HEAD becoming empty after merge.
  const revision = base || git(['merge-base', 'origin/main', 'HEAD'], cwd);
  return [...new Set([
    ...git(['diff', '--name-only', '--no-renames', revision, 'HEAD'], cwd).split('\n'),
    ...git(['diff', '--name-only', 'HEAD'], cwd).split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard'], cwd).split('\n'),
  ].filter(Boolean))];
}

export function inputHash(cwd = root, mobileOnly = false) {
  // Working contents matter; a report remains reusable after an evidence-only commit.
  const paths = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd).split('\0')
    .filter(p => p && !p.startsWith('.evidence/') && !p.endsWith('.md'))
    .filter(p => !mobileOnly || /^(apps\/mobile\/(?!e2e\/)|packages\/shared\/|package(-lock)?\.json$)/.test(p));
  const hash = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) {
    hash.update(path + '\0');
    const file = resolve(cwd, path);
    hash.update(existsSync(file) ? readFileSync(file) : '<deleted>');
    hash.update('\0');
  }
  return hash.digest('hex');
}

const insist = (condition, message) => { if (!condition) throw new Error(message); };
export function artifactPath(file, directory) {
  insist(typeof file === 'string' && file.length > 0, 'missing artifact path');
  const absolute = realpathSync(resolve(directory, file));
  insist(absolute.startsWith(realpathSync(directory) + sep), 'artifact escapes evidence directory');
  return absolute;
}
export function artifact(file, directory) {
  return readFileSync(artifactPath(file, directory));
}
export function isPlayableVideo(file) {
  let probe;
  try {
    probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
      'stream=codec_type,codec_name,duration:format=duration', '-of', 'json', file],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('ffprobe is required to validate product-flow video');
    return false;
  }
  const hasDuration = probe.streams?.some(stream => stream.codec_type === 'video' && stream.codec_name &&
    (Number(stream.duration) > 0 || Number(probe.format?.duration) > 0)) === true;
  if (!hasDuration) return false;
  try {
    // Decode one frame, not the recording. A metadata-only MP4 can pass ffprobe.
    const decoded = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', file,
      '-map', '0:v:0', '-frames:v', '1', '-f', 'framecrc', 'pipe:1'],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return /^\d+,\s*\d+,\s*\d+,\s*\d+,\s*\d+,\s*0x[\da-f]+$/im.test(decoded);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('ffmpeg is required to validate product-flow video');
    return false;
  }
}

export function validate(report, plan, hash, directory, now = Date.now(), cwd = root, nativeHash = inputHash(cwd, true), mode = 'final-candidate') {
  insist(report.version === 1 && report.inputHash === hash, 'missing or stale source/test identity');
  insist(['development', 'final-candidate', 'requested-video'].includes(mode) && report.evidenceMode === mode,
    `Expected ${mode} evidence; development or requested-video proof cannot satisfy final publication`);
  const time = Date.parse(report.finishedAt);
  insist(Number.isFinite(time) && time <= now && now - time <= 24 * 3600_000, 'evidence expired or invalid timestamp');
  insist(report.result === 'pass', 'product flow did not pass');
  for (const field of ['appHash', 'nativeSourceHash', 'bundleHash', 'backendRevision', 'simulator', 'os', 'storeMode', 'fixture', 'maestroVersion']) {
    insist(typeof report[field] === 'string' && report[field].trim() && !/^(unknown|none|n\/a)$/i.test(report[field]), `missing ${field}`);
  }
  insist(report.nativeSourceHash === nativeHash, 'native build was not produced from these inputs');
  insist(!plan.categories.includes('billing') || report.storeMode !== 'unconfigured', 'billing requires a configured store');
  insist(/^https:\/\/dev\.fitsy\.org\/?$|^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(report.backend), 'product tests require an identified dev backend');
  insist(Array.isArray(report.flows) && report.flows.length > 0, 'no flows executed');
  insist(report.videoRequested === undefined || typeof report.videoRequested === 'boolean', 'invalid recording selection');
  const videoRequested = report.videoRequested ?? report.flows.every(flow => Boolean(flow.video && flow.videoHash));
  insist(mode !== 'requested-video' || videoRequested, 'requested-video proof requires a complete recording');
  const covered = new Set();
  const names = new Set();
  for (const flow of report.flows) {
    insist(!names.has(flow.name), 'duplicate flow result'); names.add(flow.name);
    insist(/^apps\/mobile\/e2e\/flows\/[a-z0-9-]+\.yaml$/.test(flow.source), 'invalid flow source');
    const source = readFileSync(resolve(cwd, flow.source));
    insist(digest(source) === flow.sourceHash, `changed flow source: ${flow.name}`);
    const config = yaml.load(source.toString().split(/^---\s*$/m)[0]);
    insist((config.name || flow.source.split('/').at(-1).replace('.yaml', '')) === flow.name, 'flow identity mismatch');
    const data = artifact(flow.commands, directory);
    insist(digest(data) === flow.sha256, `changed command artifact: ${flow.name}`);
    const commands = JSON.parse(data.toString());
    insist(Array.isArray(commands) && commands.length > 0, 'empty command report');
    const applied = commands.find(c => c.command?.applyConfigurationCommand)?.command.applyConfigurationCommand.config;
    insist(applied?.appId === 'com.fitsy.mobile' && (!applied.name || applied.name === flow.name), 'wrong app/flow in command report');
    const assertions = commands.filter(c => c.command?.assertConditionCommand && !c.command.assertConditionCommand.optional);
    insist(assertions.length > 0 && assertions.every(c => c.metadata?.status === 'COMPLETED'), `missing/skipped/failed assertions: ${flow.name}`);
    insist(!commands.some(c => c.metadata?.status === 'FAILED'), `failed command: ${flow.name}`);
    insist(commands.every(c => c.metadata?.status === 'COMPLETED' || Object.values(c.command || {}).some(v => v?.optional === true)), `incomplete required command: ${flow.name}`);
    const screen = artifact(flow.screenshot, directory);
    insist(digest(screen) === flow.screenshotHash && screen.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), `missing/changed/non-PNG screenshot: ${flow.name}`);
    const capture = artifact(flow.captureReceipt, directory);
    insist(digest(capture) === flow.captureReceiptHash, `changed XCTest capture receipt: ${flow.name}`);
    const captures = capture.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    insist(captures.length > 0 && captures.every(item => item.udid === report.simulator && item.preferredScreenCaptureFormat === 'screenshots'),
      `missing screenshots-only XCTest launch proof: ${flow.name}`);
    if (mode === 'final-candidate')
      insist(flow.attachmentCloseout && flow.attachmentCloseoutHash, `missing XCTest attachment closeout: ${flow.name}`);
    if (flow.attachmentCloseout || flow.attachmentCloseoutHash) {
      insist(flow.attachmentCloseout && flow.attachmentCloseoutHash, `incomplete XCTest attachment closeout: ${flow.name}`);
      const closeout = artifact(flow.attachmentCloseout, directory);
      insist(digest(closeout) === flow.attachmentCloseoutHash, `changed XCTest attachment closeout: ${flow.name}`);
      const receipt = JSON.parse(closeout.toString());
      insist(receipt.udid === report.simulator && receipt.generated?.videos === 0 && receipt.deleted?.length === 0,
        `unexpected XCTest recording: ${flow.name}`);
    }
    if (!videoRequested) insist(!flow.video && !flow.videoHash, `Unrequested video claim: ${flow.name}`);
    else {
      insist(flow.video && flow.videoHash, `missing/changed/empty video: ${flow.name}`);
      let video;
      try { video = artifact(flow.video, directory); }
      catch { throw new Error(`missing/changed/empty video: ${flow.name}`); }
      insist(video.length > 0 && digest(video) === flow.videoHash, `missing/changed/empty video: ${flow.name}`);
      insist(isPlayableVideo(artifactPath(flow.video, directory)), `unplayable video: ${flow.name}`);
    }
    if (!baseline.includes(flow.name) && assertions.length >= 2) {
      for (const tag of config.tags || []) covered.add(tag);
    }
  }
  for (const name of baseline) insist(names.has(name), `missing baseline flow: ${name}`);
  for (const category of plan.categories) {
    insist(covered.has(category), `no deterministic coverage for ${category}`);
    const observation = report.exploration?.find(o => o.category === category);
    insist(observation?.result === 'pass' && observation.expected?.trim() && observation.observed?.trim(), `missing walkthrough outcome: ${category}`);
    insist(observation.branches?.includes('primary') && observation.branches?.includes('recovery'), `walkthrough needs primary and recovery: ${category}`);
    const trace = artifact(observation.trace, directory);
    insist(digest(trace) === observation.sha256, `changed walkthrough trace: ${category}`);
    const events = trace.toString().trim().split('\n').map(line => JSON.parse(line));
    insist(events.every(e => Date.parse(e.at) >= Date.parse(report.startedAt) && Date.parse(e.at) <= time && !e.result?.isError && e.result?.content?.length), `invalid/failed/stale walkthrough events: ${category}`);
    insist(events.some(e => /mobile_(click|swipe|type|press|launch|open)/.test(e.command?.name)) && events.some(e => e.command?.name === 'mobile_list_elements_on_screen'), `walkthrough needs actual interactions and screen observations: ${category}`);
  }
  return { status: 'pass', summary: `${report.flows.length} flows and ${plan.categories.length} changed-journey walkthroughs verified` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    insist(!process.env.CI || process.env.FITSY_DIFF_BASE, 'CI must supply the candidate diff base');
    const plan = impact(changedPaths(process.env.FITSY_DIFF_BASE));
    if (process.argv.includes('--plan')) {
      console.log(JSON.stringify({ ...plan, inputHash: inputHash() }));
    } else if (!plan.required) {
      console.log(JSON.stringify({ name: 'product-flow', status: 'pass', applicability: 'not_applicable', summary: 'no mobile-facing product changes', fix: '' }));
    } else {
      const file = resolve(root, '.evidence/product-flow/report.json');
      const report = JSON.parse(readFileSync(file, 'utf8'));
      const result = validate(report, plan, inputHash(), resolve(file, '..'));
      execFileSync(process.execPath, ['--env-file=apps/mobile/.env.development.local', 'scripts/sim/product-flow.mjs', 'check'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
      console.log(JSON.stringify({ name: 'product-flow', ...result, fix: '' }));
    }
  } catch (error) {
    console.log(JSON.stringify({ name: 'product-flow', status: 'fail', summary: error.message, fix: 'run the identified simulator build, required Maestro scenarios, and changed-journey walkthrough; regenerate product-flow evidence' }));
    process.exitCode = 1;
  }
}
