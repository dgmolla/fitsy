#!/usr/bin/env node
// Optional merge evidence. This must never participate in simulator acceptance.
import { execFile, spawn } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const maxBytes = 10_000_000; // evidence.py uses decimal MB and a strict less-than check.
const previewSeconds = 30;
const captureMs = 90_000;

function launch(command, args, options) {
  const child = spawn(command, args, options);
  let ended = false, failure;
  const completed = new Promise(resolve => {
    child.on('error', error => {
      failure = error.code || error.message;
      if (!child.pid) { ended = true; resolve({ error: failure }); }
    });
    child.once('close', (code, signal) => { ended = true; resolve({ code, signal, ...(failure ? { error: failure } : {}) }); });
  });
  return { child, completed, ended: () => ended };
}

async function waitFor(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}

async function stopRecorder(recorder) {
  // simctl is one directly spawned process. Signal only its live ChildProcess
  // handle, never a booted device, another recorder, or a remembered group ID.
  for (const [signal, grace] of [['SIGINT', 750], ['SIGTERM', 250], ['SIGKILL', 250]]) {
    if (recorder.ended()) return recorder.completed;
    recorder.child.kill(signal);
    const result = await waitFor(recorder.completed, grace);
    if (result) return result;
  }
  throw new Error('Recorder did not exit within its cleanup deadline');
}

async function duration(file, signal) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', file],
  { timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, signal });
  const probe = JSON.parse(stdout);
  const seconds = Number(probe.format?.duration);
  if (!probe.streams?.length || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Recording has no playable video duration');
  return seconds;
}

export async function compressPreview(source, target, { signal } = {}) {
  const seconds = await duration(source, signal);
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-itsscale', String(Math.min(1, previewSeconds / seconds)), '-i', source,
    '-t', String(previewSeconds), '-vf', 'fps=12,scale=360:-2', '-an',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-maxrate', '1500k', '-bufsize', '1500k', '-threads', '1', '-movflags', '+faststart', '-f', 'mp4', target],
  { timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, signal });
  const bytes = statSync(target).size;
  if (bytes <= 0 || bytes >= maxBytes) throw new Error('Preview must be nonempty and strictly under 10,000,000 bytes');
  const compressedSeconds = await duration(target, signal);
  if (compressedSeconds > previewSeconds + 0.1) throw new Error('Preview exceeded 30 seconds');
  return { bytes, seconds: compressedSeconds, sourceSeconds: seconds };
}

export async function withSlackVideo({ enabled = false, udid, dir, signal }, operation) {
  if (!enabled) return operation();
  let scratch, video, recorder, timer, stopping, closed = false;
  let receipt = { status: 'skipped', captureLimitSeconds: captureMs / 1000, previewLimitSeconds: previewSeconds };
  const stop = () => stopping ||= stopRecorder(recorder).then(result => { closed = true; return result; });
  try {
    try {
      if (!/^[a-f0-9-]{36}$/i.test(udid || '')) throw new Error('Recording requires the selected simulator UDID');
      mkdirSync(dir, { recursive: true });
      scratch = mkdtempSync(join(dir, '.slack-video-'));
      video = join(dir, `flow-preview-${basename(scratch).slice('.slack-video-'.length)}.mp4`);
      // Raw and incomplete encoded files have no .mp4 suffix, so evidence.py
      // cannot accidentally upload an oversized or unfinished recording.
      const log = openSync(`${video}.log`, 'w');
      try { recorder = launch('xcrun', ['simctl', 'io', udid, 'recordVideo', '--type=mp4', join(scratch, 'source.mov')],
        { stdio: ['ignore', log, log] }); }
      finally { closeSync(log); }
      recorder.child.unref(); // Failed optional cleanup must not keep the gate alive.
      receipt.recorderPid = recorder.child.pid;
      timer = setTimeout(() => { stop().catch(() => {}); }, captureMs);
      timer.unref();
    } catch (error) { receipt = { ...receipt, status: 'failed', reason: error.message }; }
    // Neither early recorder exit nor an encoding error can cancel this call,
    // alter its return value, or replace its original exception.
    return await operation();
  } finally {
    clearTimeout(timer);
    try {
      if (recorder) {
        const result = await stop();
        if (result.error || (result.code !== 0 && result.signal !== 'SIGINT')) throw new Error(`Recorder failed: ${result.error || result.code || result.signal}`);
        if (signal?.aborted) throw new Error('Preview skipped after interrupted flow');
        const media = await compressPreview(join(scratch, 'source.mov'), join(scratch, 'preview.tmp'), { signal });
        renameSync(join(scratch, 'preview.tmp'), video);
        receipt = { ...receipt, status: 'saved', video: basename(video), ...media };
      }
    } catch (error) { receipt = { ...receipt, status: 'failed', reason: error.message }; }
    // Evidence and cleanup failures are advisory too, including a full disk.
    try {
      if (scratch && (!recorder || closed)) rmSync(scratch, { recursive: true, force: true });
      if (video) writeFileSync(`${video}.json`, JSON.stringify(receipt, null, 2) + '\n');
    } catch (error) { receipt = { ...receipt, status: 'failed', reason: error.message }; }
    if (receipt.status !== 'saved') console.error(`[sim-video] ${receipt.reason || 'Recording unavailable'}; simulator result unchanged`);
  }
}

export async function runCommand(command, args, { signal } = {}) {
  if (signal?.aborted) return { code: 130 };
  const owned = launch(command, args, { stdio: 'inherit' });
  const interrupt = () => { if (!owned.ended()) owned.child.kill(signal.reason); };
  signal?.addEventListener('abort', interrupt, { once: true });
  try { return await owned.completed; }
  finally { signal?.removeEventListener('abort', interrupt); }
}

export async function main(args = process.argv.slice(2)) {
  const separator = args.indexOf('--'), options = {};
  if (separator < 0 || !args[separator + 1]) throw new Error('Usage: slack-video.mjs [--record-video] --udid=UDID --dir=PATH -- command [args...]');
  for (const arg of args.slice(0, separator)) {
    const match = /^--(udid|dir)=(.+)$|^--(record-video)$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1] || match[3])) throw new Error('Invalid recording wrapper option');
    options[match[1] || match[3]] = match[1] ? match[2] : true;
  }
  const controller = new AbortController();
  const onInt = () => controller.abort('SIGINT'), onTerm = () => controller.abort('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  try {
    const result = await withSlackVideo({ enabled: options['record-video'] || process.env.FITSY_SIM_RECORD_VIDEO === '1',
      udid: options.udid, dir: options.dir, signal: controller.signal },
    () => runCommand(args[separator + 1], args.slice(separator + 2), { signal: controller.signal }));
    if (controller.signal.aborted) return 128 + constants.signals[controller.signal.reason];
    return result.error ? 127 : result.signal ? 128 + constants.signals[result.signal] : result.code;
  } finally { process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
