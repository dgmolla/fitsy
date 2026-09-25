import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const bytes = entries => entries.reduce((total, entry) => total + entry.bytes, 0);
const videoBrands = new Set(['qt  ', 'isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ']);

function movie(file) {
  const buffer = Buffer.alloc(16);
  const fd = openSync(file, 'r');
  try {
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length < 8) return false;
    const atom = buffer.toString('ascii', 4, 8);
    const supportedBrand = atom === 'ftyp' && length >= 12 && videoBrands.has(buffer.toString('ascii', 8, 12));
    // XCTest can stage a QuickTime movie with a wide atom before mdat.
    const secondSize = buffer.readUInt32BE(8);
    const wideFirst = length >= 16 && buffer.readUInt32BE(0) === 8 && atom === 'wide' &&
      buffer.toString('ascii', 12, 16) === 'mdat' && (secondSize === 0 || secondSize >= 8);
    if (!supportedBrand && !wideFirst) return false;
  }
  finally { closeSync(fd); }
  try {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    return probe.streams?.some(stream => stream.codec_type === 'video' && stream.codec_name) === true;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('ffprobe is required to identify XCTest video attachments');
    return false;
  }
}

export function snapshotXCTestAttachments(udid, { deviceRoot = join(homedir(), 'Library/Developer/CoreSimulator/Devices') } = {}) {
  assert(/^[A-F0-9-]{36}$/i.test(udid || ''), 'XCTest attachment closeout requires an exact simulator UDID');
  const daemon = join(deviceRoot, udid, 'data/Containers/Data/InternalDaemon');
  const directories = existsSync(daemon) ? readdirSync(daemon, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => join(daemon, entry.name, 'Attachments'))
    .filter(existsSync) : [];
  const entries = [];
  for (const directory of directories) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (!item.isFile()) continue;
      const stat = lstatSync(path);
      entries.push({ path, device: stat.dev, inode: stat.ino, bytes: stat.size,
        birthtimeMs: stat.birthtimeMs, modifiedMs: stat.mtimeMs, video: movie(path) });
    }
  }
  const volume = statfsSync(deviceRoot);
  return { at: new Date().toISOString(), udid, directories, entries,
    files: entries.length, bytes: bytes(entries), videos: entries.filter(entry => entry.video).length,
    videoBytes: bytes(entries.filter(entry => entry.video)), freeBytes: volume.bavail * volume.bsize };
}

function requireIdle(directory) {
  const scan = spawnSync('lsof', ['-nP', '+D', directory], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (!scan.error && scan.signal === null && scan.status === 1 && !scan.stdout?.trim() && !scan.stderr?.trim()) return;
  throw new Error(`XCTest attachment writer scan was not clean in ${directory}: status=${scan.status}, ` +
    `error=${scan.error?.message || 'none'}, stdout=${(scan.stdout || '').slice(0, 500)}, stderr=${(scan.stderr || '').slice(0, 500)}`);
}

export function closeoutXCTestAttachments(before, after, { idleCheck = requireIdle, remove = rmSync } = {}) {
  assert(before.udid === after.udid, 'XCTest attachment snapshots belong to different simulators');
  const prior = new Map(before.entries.map(entry => [entry.path, entry]));
  const created = after.entries.filter(entry => {
    const old = prior.get(entry.path);
    return !old || old.device !== entry.device || old.inode !== entry.inode;
  });
  const newVideos = created.filter(entry => entry.video);
  for (const directory of new Set(newVideos.map(entry => entry.path.slice(0, entry.path.lastIndexOf('/'))))) idleCheck(directory);
  for (const entry of newVideos) {
    const stat = lstatSync(entry.path);
    assert(stat.isFile() && stat.dev === entry.device && stat.ino === entry.inode && stat.size === entry.bytes && movie(entry.path),
      `XCTest attachment changed before exact-file retirement: ${entry.path}`);
    remove(entry.path);
  }
  const remaining = after.entries.filter(entry => entry.video && !newVideos.includes(entry));
  const volume = statfsSync(after.directories[0] || join(homedir(), 'Library/Developer/CoreSimulator/Devices'));
  return { at: new Date().toISOString(), udid: before.udid,
    before: { files: before.files, bytes: before.bytes, videos: before.videos, videoBytes: before.videoBytes, freeBytes: before.freeBytes },
    after: { files: after.files, bytes: after.bytes, videos: after.videos, videoBytes: after.videoBytes, freeBytes: after.freeBytes },
    generated: { files: created.length, bytes: bytes(created), videos: newVideos.length, videoBytes: bytes(newVideos) },
    deleted: newVideos.map(entry => ({ path: entry.path, bytes: entry.bytes, device: entry.device, inode: entry.inode })),
    remainingVideos: remaining.map(entry => ({ path: entry.path, bytes: entry.bytes, reason: 'pre-phase ownership unresolved; historical cleanup is separate' })),
    freeBytesAfterRetirement: volume.bavail * volume.bsize,
    measuredRecoveryBytes: volume.bavail * volume.bsize - after.freeBytes,
    note: 'Before and after snapshots are phase boundaries. Only newly created QuickTime files are retired after writer idle proof.' };
}
