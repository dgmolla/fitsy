import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { isMain } from '../verify/impact-plan.mjs';
const yaml = createRequire(import.meta.url)('js-yaml');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function expiredScreen(text) {
  const normalized = text.replace(/\s+/g, ' ').toLowerCase();
  return /\bsubscription (?:has )?(?:ended|expired)\b/.test(normalized) ||
    normalized.includes('resubscribe-restore') ||
    (normalized.includes('welcome back') && normalized.includes('resubscribe'));
}

export function testsExpiredScreen(source = '') {
  const [header, steps] = yaml.loadAll(source.toString());
  // A broad billing tag, filename or prose claim cannot waive this check.
  return header?.tags?.some(tag => ['fixture:expired-subscription', 'fixture:apple-history'].includes(tag)) === true &&
    Array.isArray(steps) && steps.some(step => step.assertVisible?.id === 'resubscribe-restore' && !step.assertVisible.optional);
}

export function recognizeScreen(file) {
  try {
    const text = execFileSync('tesseract', [file, 'stdout', '-l', 'eng'],
      { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!text.trim()) throw new Error('No recognized screenshot text');
    return text;
  } catch { throw new Error('Screenshot OCR failed; install working tesseract with English data and retain the failed capture'); }
}

export function requireScreenRecognition() {
  try {
    const languages = execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!languages.split(/\r?\n/).includes('eng')) throw new Error('English OCR data is missing');
  } catch { throw new Error('tesseract with English data is required for screenshot content checks before simulator execution'); }
}

export function inspectScreenshot(file, source, recognize = recognizeScreen) {
  const text = recognize(file), expired = expiredScreen(text), expectedExpired = testsExpiredScreen(source);
  if (!text.trim()) throw new Error('Screenshot text could not be recognized');
  const check = { version: 1, screenshotHash: sha(readFileSync(file)), expired, expectedExpired };
  if (expired && !expectedExpired) throw new Error(`Unexpected subscription-expired screenshot: ${file}`);
  return check;
}

export function assertScreenCheck(check, bytes, source) {
  if (check?.version !== 1 || check.screenshotHash !== sha(bytes) ||
      typeof check.expired !== 'boolean' || check.expectedExpired !== testsExpiredScreen(source) ||
      (check.expired && !check.expectedExpired)) throw new Error('Missing, changed or expired-screen screenshot content check');
}

export function inspectScreenshotDirectory(directory, source) {
  return readdirSync(directory, { recursive: true }).filter(file => /\.png$/i.test(file) && !file.startsWith('active-setup/')).sort()
    .map(file => ({ file, ...inspectScreenshot(join(directory, file), source) }));
}

if (isMain(import.meta.url)) {
  try {
    const [directory, flow] = process.argv.slice(2);
    if (!directory) throw new Error('Usage: screen-guard.mjs <capture.png|directory> [maintained-expired-flow.yaml]');
    const target = resolve(directory), source = flow ? readFileSync(resolve(flow)) : '';
    const checks = statSync(target).isFile() ? [{ file: target, ...inspectScreenshot(target, source) }]
      : inspectScreenshotDirectory(target, source);
    if (!checks.length) throw new Error('No screenshots found for evidence content validation');
    console.log(JSON.stringify({ result: 'pass', checks }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

export function inspectWalkthrough(events, source = '', recognize = recognizeScreen) {
  const expectedExpired = testsExpiredScreen(source);
  for (const event of events) for (const item of event.result?.content || []) {
    // Read observation results only. An assertion command or prompt can mention
    // the forbidden screen without ever displaying it.
    if (item.type === 'text' && ['inspect_view_hierarchy', 'mobile_list_elements_on_screen'].includes(event.command?.name) &&
        expiredScreen(item.text || '') && !expectedExpired)
      throw new Error('Unexpected subscription-expired screen in walkthrough observation');
    if (item.type !== 'image') continue;
    if (!item.data || item.mimeType !== 'image/png') throw new Error('Walkthrough screenshot must contain PNG pixels');
    const dir = mkdtempSync(join(tmpdir(), 'fitsy-walkthrough-screen-'));
    try {
      const file = join(dir, 'screen.png'); writeFileSync(file, Buffer.from(item.data, 'base64'));
      inspectScreenshot(file, source, recognize);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}
