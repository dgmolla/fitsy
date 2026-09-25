import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeoutXCTestAttachments, snapshotXCTestAttachments } from './xctest-attachments.mjs';

const udid = '9E661282-FCE3-4C70-A503-EB2FFA0AD02B';
const quicktime = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('ftyp'), Buffer.from('qt  ')]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('ftyp'), Buffer.from('mp42')]);
const heic = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('ftyp'), Buffer.from('heic')]);
const unknown = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('ftyp'), Buffer.from('zzzz')]);
const wideQuicktime = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('wide'), Buffer.from([0, 0, 0, 16]), Buffer.from('mdat'), Buffer.alloc(8)]);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-xctest-'));
  const attachments = join(root, udid, 'data/Containers/Data/InternalDaemon/owned/Attachments');
  mkdirSync(attachments, { recursive: true });
  return { root, attachments };
}

test('phase closeout retires only newly generated extensionless QuickTime after idle proof', () => {
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

test('active attachment writer blocks exact-file video retirement', () => {
  const { root, attachments } = fixture();
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const newVideo = join(attachments, 'new-uuid');
    writeFileSync(newVideo, quicktime);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    assert.throws(() => closeoutXCTestAttachments(before, after, { idleCheck: () => { throw Error('writer active'); } }), /writer active/);
    assert.equal(readFileSync(newVideo).toString('hex'), quicktime.toString('hex'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('closeout preserves HEIC and unknown attachments while retiring supported movies', () => {
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

test('wide-first QuickTime attachment requires idle proof before retirement', () => {
  const { root, attachments } = fixture();
  try {
    const before = snapshotXCTestAttachments(udid, { deviceRoot: root });
    const video = join(attachments, 'wide-first-uuid');
    writeFileSync(video, wideQuicktime);
    const after = snapshotXCTestAttachments(udid, { deviceRoot: root });
    assert.equal(after.videos, 1);
    assert.throws(() => closeoutXCTestAttachments(before, after, { idleCheck: () => { throw Error('writer active'); } }), /writer active/);
    assert.equal(readFileSync(video).toString('hex'), wideQuicktime.toString('hex'));
    const result = closeoutXCTestAttachments(before, after, { idleCheck: () => {} });
    assert.equal(result.generated.videos, 1);
    assert.equal(result.deleted.length, 1);
    assert.throws(() => readFileSync(video), { code: 'ENOENT' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no-video phase records zero generated videos without deleting historical attachments', () => {
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
