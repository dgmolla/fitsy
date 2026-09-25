#!/usr/bin/env node
// The local real-media lane produces the same source-bound receipt shape used
// by review dispositions. The product-flow publisher checks it on PR heads.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths, inputHash, repoEnv, root } from './product-flow.mjs';

const receiptFile = resolve(root, '.evidence/verify/media-integration.json');
const command = 'FITSY_MEDIA_INTEGRATION=1 npm test --workspace=@fitsy/scripts -- --runInBand --runTestsByPath verify/product-flow.test.ts sim/xctest-attachments.test.ts sim/runner-controls.test.ts';
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', env: repoEnv() }).trim();

export function mediaIntegrationRequired(paths) {
  return paths.some(path => /^scripts\/sim\/|^scripts\/verify\/(?:product-flow|media-integration|test\.sh|registry\.yml)/.test(path));
}

export function writeMediaReceipt(file = receiptFile, sourceSha = head(), sourceHash = inputHash()) {
  const receipt = { id: 'media-integration', source_sha: sourceSha, input_hash: sourceHash,
    command, result: 'pass', exit_code: 0, finished_at: new Date().toISOString() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function validateMediaReceipt(paths, sourceSha, sourceHash, file = receiptFile, now = Date.now()) {
  if (!mediaIntegrationRequired(paths)) return { required: false };
  let receipt;
  try { receipt = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('Missing local media integration receipt; rerun the local media-integration check on the committed PR head'); }
  const finished = Date.parse(receipt.finished_at);
  if (receipt.id !== 'media-integration' || receipt.source_sha !== sourceSha || receipt.input_hash !== sourceHash ||
      receipt.command !== command || receipt.result !== 'pass' || receipt.exit_code !== 0 ||
      !Number.isFinite(finished) || finished > now || now - finished > 24 * 3600_000)
    throw new Error('Stale or failed local media integration receipt; rerun the local media-integration check on the committed PR head');
  return { required: true, finishedAt: receipt.finished_at };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2];
    if (action === '--required') process.exitCode = mediaIntegrationRequired(changedPaths(process.env.FITSY_DIFF_BASE)) ? 0 : 2;
    else if (action === '--record') console.log(JSON.stringify(writeMediaReceipt()));
    else throw new Error('Usage: media-integration.mjs --required|--record');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
