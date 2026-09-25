import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const bytes = entries => entries.reduce((total, entry) => total + entry.bytes, 0);
const imageBrands = new Set([
  'avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs',
  'mif1', 'msf1', 'miaf', 'miai',
]);
const maxBoxes = 512;
const maxFtypBytes = 4096;

function container(file) {
  const fd = openSync(file, 'r');
  try {
    const fileBytes = fstatSync(fd).size;
    const header = Buffer.alloc(16);
    let offset = 0;
    let boxes = 0;
    let firstType;
    let hasMovie = false;
    let hasMedia = false;
    let imageFamily = false;
    while (offset < fileBytes && boxes++ < maxBoxes) {
      if (fileBytes - offset < 8 || readSync(fd, header, 0, 8, offset) !== 8)
        return { uncertainty: 'incomplete ISO media box header' };
      const type = header.toString('ascii', 4, 8);
      if (firstType === undefined) {
        firstType = type;
        if (type !== 'ftyp' && type !== 'wide') return {};
      }
      let headerBytes = 8;
      let boxBytes = header.readUInt32BE(0);
      if (boxBytes === 1) {
        if (fileBytes - offset < 16 || readSync(fd, header, 8, 8, offset + 8) !== 8)
          return { uncertainty: 'incomplete extended ISO media box' };
        const extended = header.readBigUInt64BE(8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return { uncertainty: 'ISO media box exceeds safe offset' };
        boxBytes = Number(extended);
        headerBytes = 16;
      } else if (boxBytes === 0) {
        boxBytes = fileBytes - offset;
      }
      if (boxBytes < headerBytes || boxBytes > fileBytes - offset)
        return { uncertainty: 'invalid ISO media box size' };
      if (type === 'ftyp') {
        if (boxBytes < headerBytes + 8 || boxBytes > maxFtypBytes || (boxBytes - headerBytes - 8) % 4)
          return { uncertainty: 'unreadable ISO media brand list' };
        const brands = Buffer.alloc(boxBytes - headerBytes);
        if (readSync(fd, brands, 0, brands.length, offset + headerBytes) !== brands.length)
          return { uncertainty: 'incomplete ISO media brand list' };
        for (let index = 0; index < brands.length; index += index === 0 ? 8 : 4) {
          if (imageBrands.has(brands.toString('ascii', index, index + 4))) imageFamily = true;
        }
      }
      if (type === 'moov') hasMovie = true;
      if (type === 'mdat') hasMedia = true;
      offset += boxBytes;
    }
    if (imageFamily) return {};
    if (offset !== fileBytes) return { uncertainty: 'ISO media box scan limit reached' };
    if (!hasMovie || !hasMedia) return { uncertainty: 'ISO media file lacks complete movie structure' };
    return { movie: true };
  } finally { closeSync(fd); }
}

function movie(file) {
  const shape = container(file);
  if (!shape.movie) return { video: false, uncertainty: shape.uncertainty };
  try {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name:stream=codec_type,codec_name', '-of', 'json', file],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    if (!probe.format?.format_name?.split(',').some(name => name === 'mov' || name === 'mp4'))
      return { video: false, uncertainty: 'ffprobe did not identify a movie demuxer' };
    if (!Array.isArray(probe.streams) || probe.streams.length === 0)
      return { video: false, uncertainty: 'movie structure has no readable streams' };
    return { video: probe.streams?.some(stream => stream.codec_type === 'video' && stream.codec_name) === true };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('ffprobe is required to identify XCTest video attachments');
    return { video: false, uncertainty: `ffprobe failed: ${error.code || error.name || 'invalid output'}` };
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
      const classification = movie(path);
      entries.push({ path, device: stat.dev, inode: stat.ino, bytes: stat.size,
        birthtimeMs: stat.birthtimeMs, modifiedMs: stat.mtimeMs, ...classification });
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
    assert(stat.isFile() && stat.dev === entry.device && stat.ino === entry.inode && stat.size === entry.bytes && movie(entry.path).video,
      `XCTest attachment changed before exact-file retirement: ${entry.path}`);
    remove(entry.path);
  }
  const remaining = after.entries.filter(entry => entry.video && !newVideos.includes(entry));
  const volume = statfsSync(after.directories[0] || join(homedir(), 'Library/Developer/CoreSimulator/Devices'));
  return { at: new Date().toISOString(), udid: before.udid,
    before: { files: before.files, bytes: before.bytes, videos: before.videos, videoBytes: before.videoBytes, freeBytes: before.freeBytes },
    after: { files: after.files, bytes: after.bytes, videos: after.videos, videoBytes: after.videoBytes, freeBytes: after.freeBytes },
    generated: { files: created.length, bytes: bytes(created), videos: newVideos.length, videoBytes: bytes(newVideos) },
    uncertainAttachments: created.filter(entry => entry.uncertainty).map(entry => ({ path: entry.path, reason: entry.uncertainty })),
    deleted: newVideos.map(entry => ({ path: entry.path, bytes: entry.bytes, device: entry.device, inode: entry.inode })),
    remainingVideos: remaining.map(entry => ({ path: entry.path, bytes: entry.bytes, reason: 'pre-phase ownership unresolved; historical cleanup is separate' })),
    freeBytesAfterRetirement: volume.bavail * volume.bsize,
    measuredRecoveryBytes: volume.bavail * volume.bsize - after.freeBytes,
    note: 'Before and after snapshots are phase boundaries. Only positively identified current-phase movies are retired after writer idle proof; uncertain files are preserved.' };
}
