import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { closeoutXCTestAttachments, snapshotXCTestAttachments } from './xctest-attachments.mjs';

const udid = '9E661282-FCE3-4C70-A503-EB2FFA0AD02B';
const quicktime = readFileSync(new URL('./fixtures/quicktime.mov', import.meta.url));
const mp4 = readFileSync(new URL('../verify/fixtures/valid.mp4', import.meta.url));
const leadingFreeMp4 = readFileSync(new URL('./fixtures/leading-free.mp4', import.meta.url));
const audioOnly = readFileSync(new URL('./fixtures/audio-only.mp4', import.meta.url));
const iso5 = readFileSync(new URL('./fixtures/valid-iso5.mp4', import.meta.url));
const validHeic = readFileSync(new URL('./fixtures/valid-image.heic', import.meta.url));
const heic = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('ftyp'), Buffer.from('heic')]);
const leadingFreeHeic = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('free'), validHeic]);
const malformedLeadingFree = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('free'),
  Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp')]);
const unknown = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('ftyp'), Buffer.from('zzzz')]);
const wideQuicktime = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('wide'), Buffer.from([0, 0, 0, 16]), Buffer.from('mdat'), Buffer.alloc(8)]);
// Real decoder cases register only in the required local media lane.
const mediaTest = process.env.FITSY_MEDIA_INTEGRATION === '1' ? test : () => {};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-xctest-'));
  const attachments = join(root, udid, 'data/Containers/Data/InternalDaemon/owned/Attachments');
  mkdirSync(attachments, { recursive: true });
  return { root, attachments };
}

mediaTest('phase closeout retires only newly generated extensionless QuickTime after idle proof', () => {
  const { root, attachments } = fixture();
  try {
    const oldVideo = join(attachments, 'old-uuid');
    writeFileSync(oldVideo, quicktime);
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const newVideo = join(attachments, 'new-uuid');
    const screenshot = join(attachments, 'new-screen');
    writeFileSync(newVideo, quicktime);
    writeFileSync(screenshot, Buffer.from('PNG evidence'));
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const checked = [];
    const result = closeoutXCTestAttachments(before, after, { idleCheck: path => checked.push(path) });
    assert.deepEqual(checked, [attachments]);
    assert.equal(result.generated.videos, 1);
    assert.equal(result.deleted.length, 1);
    assert.equal(result.remainingVideos.length, 1);
    assert.equal(result.remainingVideos[0].path, oldVideo);
    assert.equal(readFileSync(oldVideo).toString('hex'), quicktime.toString('hex'));
    assert.equal(readFileSync(screenshot, 'utf8'), 'PNG evidence');
    assert.throws(() => readFileSync(newVideo), { code: 'ENOENT' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

mediaTest('active attachment writer blocks exact-file video retirement', () => {
  const { root, attachments } = fixture();
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const newVideo = join(attachments, 'new-uuid');
    writeFileSync(newVideo, leadingFreeMp4);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    assert.throws(() => closeoutXCTestAttachments(before, after, { idleCheck: () => { throw Error('writer active'); } }), /writer active/);
    assert.deepEqual(readFileSync(newVideo), leadingFreeMp4);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

mediaTest('closeout preserves HEIC and unknown attachments while retiring supported movies', () => {
  const { root, attachments } = fixture();
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const image = join(attachments, 'new-heic');
    const other = join(attachments, 'new-unknown');
    const video = join(attachments, 'new-mp4');
    writeFileSync(image, heic);
    writeFileSync(other, unknown);
    writeFileSync(video, mp4);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const checked = [];
    const result = closeoutXCTestAttachments(before, after, { idleCheck: path => checked.push(path) });
    assert.deepEqual(checked, [attachments]);
    assert.equal(result.generated.videos, 1);
    assert.deepEqual(result.deleted.map(entry => entry.path), [video]);
    assert.deepEqual(readFileSync(image), heic);
    assert.deepEqual(readFileSync(other), unknown);
    assert.throws(() => readFileSync(video), { code: 'ENOENT' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

mediaTest('actual closeout classifies movie structure and preserves image, audio and ambiguous files', () => {
  const { root, attachments } = fixture();
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const wideFirst = Buffer.concat([quicktime.subarray(20, 28), quicktime.subarray(0, 20), quicktime.subarray(28)]);
    const files = new Map([
      ['quicktime', quicktime], ['wide-quicktime', wideFirst], ['ordinary-mp4', mp4],
      ['leading-free-mp4', leadingFreeMp4], ['iso5-mp4', iso5],
      ['heic-image', validHeic], ['leading-free-heic', leadingFreeHeic],
      ['audio-only', audioOnly], ['unknown', unknown], ['malformed-leading-free', malformedLeadingFree],
      ['unprobeable', Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypiso5'), Buffer.alloc(4),
        Buffer.from([0, 0, 0, 8]), Buffer.from('moov'), Buffer.from([0, 0, 0, 8]), Buffer.from('mdat')])],
    ]);
    for (const [name, content] of files) writeFileSync(join(attachments, name), content);
    const heicProbe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', join(attachments, 'heic-image')],
      { encoding: 'utf8' }));
    assert.equal(heicProbe.streams.some(stream => stream.codec_type === 'video'), true,
      'the valid still image must expose the video-labeled stream ambiguity');
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const checked = [];
    const result = closeoutXCTestAttachments(before, after, { idleCheck: directory => checked.push(directory) });
    assert.deepEqual(checked, [attachments]);
    assert.deepEqual(result.deleted.map(entry => entry.path).sort(),
      ['quicktime', 'wide-quicktime', 'ordinary-mp4', 'leading-free-mp4', 'iso5-mp4'].map(name => join(attachments, name)).sort());
    assert.equal(result.generated.videos, 5);
    assert.equal(result.uncertainAttachments.some(entry => entry.path === join(attachments, 'unknown')), true);
    assert.equal(result.uncertainAttachments.some(entry => entry.path === join(attachments, 'unprobeable')), true);
    assert.equal(result.uncertainAttachments.some(entry => entry.path === join(attachments, 'malformed-leading-free')), true);
    for (const name of ['quicktime', 'wide-quicktime', 'ordinary-mp4', 'leading-free-mp4', 'iso5-mp4'])
      assert.equal(existsSync(join(attachments, name)), false, `${name} retired`);
    for (const name of ['heic-image', 'leading-free-heic', 'audio-only', 'unknown', 'unprobeable', 'malformed-leading-free'])
      assert.deepEqual(readFileSync(join(attachments, name)), files.get(name), `${name} preserved`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('actual closeout preserves movie-shaped attachment after probe failure', () => {
  const { root, attachments } = fixture();
  const priorPath = process.env.PATH;
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const video = join(attachments, 'probe-error');
    writeFileSync(video, iso5);
    process.env.PATH = `${fakeLsof(root, 'exit 2')}:${priorPath}`;
    const tool = join(root, 'bin', 'ffprobe');
    writeFileSync(tool, '#!/bin/sh\nexit 2\n');
    chmodSync(tool, 0o755);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    assert.equal(after.entries[0].video, false);
    assert.match(after.entries[0].uncertainty, /ffprobe failed/);
    assert.equal(closeoutXCTestAttachments(before, after).deleted.length, 0);
    assert.deepEqual(readFileSync(video), iso5);
  } finally {
    process.env.PATH = priorPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test('unprobeable wide-first QuickTime candidate is preserved', () => {
  const { root, attachments } = fixture();
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const video = join(attachments, 'wide-first-uuid');
    writeFileSync(video, wideQuicktime);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    assert.equal(after.videos, 0);
    assert.equal(readFileSync(video).toString('hex'), wideQuicktime.toString('hex'));
    const result = closeoutXCTestAttachments(before, after, { idleCheck: () => { throw Error('must not inspect unprobeable candidate'); } });
    assert.equal(result.generated.videos, 0);
    assert.equal(result.deleted.length, 0);
    assert.deepEqual(readFileSync(video), wideQuicktime);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

mediaTest('actual closeout preserves audio-only MP4 even with a video-compatible container brand', () => {
  const { root, attachments } = fixture();
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const audio = join(attachments, 'audio-only-uuid');
    writeFileSync(audio, audioOnly);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    assert.equal(after.videos, 0);
    const result = closeoutXCTestAttachments(before, after, { idleCheck: () => { throw Error('audio must not trigger idle scan'); } });
    assert.equal(result.deleted.length, 0);
    assert.deepEqual(readFileSync(audio), audioOnly);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function fakeLsof(root, body) {
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const tool = join(bin, 'lsof');
  writeFileSync(tool, `#!/bin/sh\n${body}\n`);
  chmodSync(tool, 0o755);
  return bin;
}

mediaTest('actual closeout rejects lsof warning while an owned child holds the video open', async () => {
  const { root, attachments } = fixture();
  const priorPath = process.env.PATH;
  let child;
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const video = join(attachments, 'writer-held-uuid');
    writeFileSync(video, leadingFreeMp4);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const ready = join(root, 'holder-ready');
    child = spawn(process.execPath, ['-e',
      "const fs=require('node:fs');const fd=fs.openSync(process.argv[1],'r');fs.writeFileSync(process.argv[2],'ready');setInterval(()=>fs.fsyncSync(fd),100)",
      video, ready], { stdio: 'ignore' });
    for (let i = 0; i < 100 && !existsSync(ready); i++) await delay(20);
    assert.equal(existsSync(ready), true, 'owned file holder started');
    process.env.PATH = `${fakeLsof(root, "echo 'lsof: WARNING: scan incomplete' >&2; exit 1")}:${priorPath}`;
    assert.throws(() => closeoutXCTestAttachments(before, after), /writer scan was not clean.*WARNING/);
    assert.deepEqual(readFileSync(video), leadingFreeMp4);
  } finally {
    process.env.PATH = priorPath;
    if (child) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
    rmSync(root, { recursive: true, force: true });
  }
});

mediaTest('actual closeout retires extensionless video after clean no-writer lsof result', () => {
  const { root, attachments } = fixture();
  const priorPath = process.env.PATH;
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const video = join(attachments, 'extensionless-video-uuid');
    writeFileSync(video, quicktime);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    process.env.PATH = `${fakeLsof(root, 'exit 1')}:${priorPath}`;
    const result = closeoutXCTestAttachments(before, after);
    assert.equal(result.deleted.length, 1);
    assert.equal(result.deleted[0].path, video);
    assert.equal(existsSync(video), false);
  } finally {
    process.env.PATH = priorPath;
    rmSync(root, { recursive: true, force: true });
  }
});

mediaTest('no-video phase records zero generated videos without deleting historical attachments', () => {
  const { root, attachments } = fixture();
  try {
    const oldVideo = join(attachments, 'old-uuid');
    writeFileSync(oldVideo, quicktime);
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    writeFileSync(join(attachments, 'new-screen'), Buffer.from('PNG evidence'));
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const result = closeoutXCTestAttachments(before, after, { idleCheck: () => { throw Error('must not inspect unrelated old video'); } });
    assert.equal(result.generated.videos, 0);
    assert.equal(result.deleted.length, 0);
    assert.equal(result.remainingVideos.length, 1);
    assert.equal(readFileSync(oldVideo).toString('hex'), quicktime.toString('hex'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
