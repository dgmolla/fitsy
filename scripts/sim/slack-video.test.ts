import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const wrapper = resolve(__dirname, 'slack-video.mjs');
const udid = '54503F5C-8A3C-4699-8401-2E1D32890A24';
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FITSY_|SIM_VIDEO_)/.test(key)));
let root: string, bin: string, dir: string, env: NodeJS.ProcessEnv;

function executable(name: string, source: string) {
  const path = join(bin, name);
  writeFileSync(path, `#!${process.execPath}\n${source}\n`);
  chmodSync(path, 0o755);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-slack-video-'));
  bin = join(root, 'bin'); dir = join(root, 'screenshots');
  mkdirSync(bin); mkdirSync(dir);
  env = { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`, SIM_VIDEO_DIR: root };
  // Only the external native recorder and encoder are replaced. The production
  // wrapper, subprocess lifecycle and filesystem publication run unchanged.
  executable('xcrun', `
    const fs = require('node:fs'), path = require('node:path');
    const root = process.env.SIM_VIDEO_DIR;
    const ready = () => fs.writeFileSync(path.join(root, 'recorder.json'), JSON.stringify({pid: process.pid, args: process.argv.slice(2)}));
    if (process.env.SIM_VIDEO_CASE === 'recorder-failure') {ready(); process.exit(9);}
    const file = process.argv.at(-1);
    if (process.env.SIM_VIDEO_SOURCE) fs.copyFileSync(process.env.SIM_VIDEO_SOURCE, file);
    else fs.writeFileSync(file, 'fixture video');
    const stop = () => { fs.writeFileSync(path.join(root, 'recorder-stopped'), 'yes'); process.exit(0); };
    process.on('SIGINT', process.env.SIM_VIDEO_CASE === 'stalled-recorder' ? () => {} : stop);
    process.on('SIGTERM', process.env.SIM_VIDEO_CASE === 'stalled-recorder' ? () => {} : stop);
    ready();
    if (process.env.SIM_VIDEO_CASE === 'early-exit') process.exit(0);
    setInterval(() => {}, 1000);
  `);
  executable('ffprobe', `
    if (process.env.SIM_VIDEO_CASE === 'probe-failure') process.exit(1);
    process.stdout.write(JSON.stringify({streams:[{codec_name:'h264'}], format:{duration:'1'}}));
  `);
  executable('ffmpeg', `
    const fs = require('node:fs');
    if (process.env.SIM_VIDEO_CASE === 'encoder-failure') process.exit(2);
    if (process.env.SIM_VIDEO_CASE === 'stalled-encoder') { setInterval(() => {}, 1000); }
    else {
      const file = process.argv.at(-1);
      fs.writeFileSync(file, 'compressed preview');
      if (process.env.SIM_VIDEO_CASE === 'oversized') fs.truncateSync(file, 10000000);
      if (process.env.SIM_VIDEO_CASE === 'empty') fs.truncateSync(file, 0);
    }
  `);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function invoke(code = 0, options: string[] = ['--record-video'], extra: NodeJS.ProcessEnv = {}) {
  for (const marker of ['recorder.json', 'recorder-stopped']) rmSync(join(root, marker), { force: true });
  return spawnSync(process.execPath, [wrapper, ...options, `--udid=${udid}`, `--dir=${dir}`, '--', process.execPath, '-e',
    `const fs = require('node:fs'), path = require('node:path');
     process.stdout.write('maestro output'); process.stderr.write('maestro diagnostic');
     const deadline = Date.now() + 3000;
     const finish = () => {
       if (!fs.existsSync(path.join(process.env.SIM_VIDEO_DIR, 'recorder.json')) && Date.now() < deadline && ${options.includes('--record-video') || extra.FITSY_SIM_RECORD_VIDEO === '1'}) return setTimeout(finish, 10);
       setTimeout(() => process.exit(${code}), 30);
     }; finish();`],
  { env: { ...env, ...extra }, encoding: 'utf8', timeout: 12000 });
}
const previews = () => readdirSync(dir).filter(file => file.endsWith('.mp4'));
const receipt = () => JSON.parse(readFileSync(join(dir, readdirSync(dir).find(file => file.endsWith('.mp4.json'))!), 'utf8'));

test.each([0, 7])('disabled recording passes through Maestro exit %s and streams without touching media tools', code => {
  const result = invoke(code, []);
  expect(result.status).toBe(code);
  expect(result.stdout).toBe('maestro output'); expect(result.stderr).toBe('maestro diagnostic');
  expect(existsSync(join(root, 'recorder.json'))).toBe(false);
  expect(readdirSync(dir)).toEqual([]);
});

test.each([0, 7])('opt-in recording preserves exit %s and publishes alongside screenshots after finalization', code => {
  writeFileSync(join(dir, 'screen.png'), 'existing screenshot');
  const result = invoke(code);
  expect(result.status).toBe(code); expect(result.stdout).toBe('maestro output');
  expect(result.stderr).toBe('maestro diagnostic');
  expect(previews()).toHaveLength(1);
  expect(receipt()).toMatchObject({ status: 'saved', video: previews()[0], bytes: 18 });
  expect(readFileSync(join(dir, 'screen.png'), 'utf8')).toBe('existing screenshot');
  const recorder = JSON.parse(readFileSync(join(root, 'recorder.json'), 'utf8'));
  expect(recorder.args.slice(0, 5)).toEqual(['simctl', 'io', udid, 'recordVideo', '--type=mp4']);
  expect(existsSync(join(root, 'recorder-stopped'))).toBe(true);
  expect(readdirSync(dir).some(file => file.startsWith('.slack-video-'))).toBe(false);
  expect(() => process.kill(recorder.pid, 0)).toThrow();
});

test('the existing poller can opt in through its environment', () => {
  expect(invoke(0, [], { FITSY_SIM_RECORD_VIDEO: '1' }).status).toBe(0);
  expect(previews()).toHaveLength(1);
});

test.each(['recorder-failure', 'probe-failure', 'encoder-failure', 'oversized', 'empty', 'stalled-recorder'])('%s never changes a passing or failing gate and publishes no invalid MP4', failure => {
  for (const code of [0, 7]) {
    const result = invoke(code, ['--record-video'], { SIM_VIDEO_CASE: failure });
    expect(result.status).toBe(code);
    expect(result.stdout).toBe('maestro output');
    expect(result.stderr).toContain('simulator result unchanged');
    expect(previews()).toEqual([]);
    expect(receipt().status).toBe('failed');
    expect(readdirSync(dir).some(file => file.startsWith('.slack-video-'))).toBe(false);
    const recorder = JSON.parse(readFileSync(join(root, 'recorder.json'), 'utf8'));
    expect(() => process.kill(recorder.pid, 0)).toThrow();
  }
}, 10000);

test('an encoder that never completes is killed within the evidence budget', () => {
  const started = Date.now();
  const result = invoke(0, ['--record-video'], { SIM_VIDEO_CASE: 'stalled-encoder' });
  expect(result.status).toBe(0);
  expect(Date.now() - started).toBeLessThan(8500);
  expect(previews()).toEqual([]);
  expect(receipt().status).toBe('failed');
}, 10000);

test('unwritable evidence and an absent recorder cannot prevent the original operation', () => {
  const file = join(root, 'file'); writeFileSync(file, 'not a directory');
  const result = spawnSync(process.execPath, [wrapper, '--record-video', `--udid=${udid}`, `--dir=${file}`, '--',
    process.execPath, '-e', 'process.exit(7)'], { env, encoding: 'utf8' });
  expect(result.status).toBe(7);
  expect(result.stderr).toContain('simulator result unchanged');
  rmSync(join(bin, 'xcrun'));
  expect(invoke(0, ['--record-video'], { PATH: bin }).status).toBe(0);
  expect(previews()).toEqual([]);
});

test('early recorder exit preserves the operation return value and original thrown error', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { withSlackVideo } from ${JSON.stringify(wrapper)};
    const options = {enabled:true, udid:${JSON.stringify(udid)}, dir:${JSON.stringify(dir)}};
    const value = {code:7, reason:'original gate failure'};
    const error = new Error('original exception');
    const delay = () => new Promise(resolve => setTimeout(resolve, 180));
    const returned = await withSlackVideo(options, async () => { await delay(); return value; });
    let sameError = false;
    try { await withSlackVideo(options, async () => { await delay(); throw error; }); }
    catch (caught) { sameError = caught === error; }
    process.stdout.write(JSON.stringify({sameValue:returned === value, sameError}));
  `], { env: { ...env, SIM_VIDEO_CASE: 'early-exit' }, encoding: 'utf8', timeout: 5000 });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ sameValue: true, sameError: true });
});

test.each(['SIGINT', 'SIGTERM'] as const)('%s stops recording and preserves interruption even when Maestro handles the signal', async signal => {
  const child = spawn(process.execPath, [wrapper, '--record-video', `--udid=${udid}`, `--dir=${dir}`, '--', process.execPath, '-e', `
    const fs = require('node:fs');
    process.on('${signal}', () => {fs.writeFileSync(${JSON.stringify(join(root, 'maestro-stopped'))}, 'yes'); process.exit(0);});
    fs.writeFileSync(${JSON.stringify(join(root, 'maestro-ready'))}, 'yes');
    setInterval(() => {}, 1000);
  `], { env, stdio: 'ignore' });
  const completed = new Promise(resolve => child.once('close', code => resolve(code)));
  try {
    const deadline = Date.now() + 3000;
    while ((!existsSync(join(root, 'maestro-ready')) || !existsSync(join(root, 'recorder.json'))) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    expect(existsSync(join(root, 'maestro-ready'))).toBe(true);
    expect(existsSync(join(root, 'recorder.json'))).toBe(true);
    child.kill(signal);
    expect(await completed).toBe(signal === 'SIGINT' ? 130 : 143);
    expect(existsSync(join(root, 'maestro-stopped'))).toBe(true);
    expect(existsSync(join(root, 'recorder-stopped'))).toBe(true);
    expect(previews()).toEqual([]);
  } finally { child.kill('SIGKILL'); await completed; }
});

const mediaTest = process.env.FITSY_MEDIA_INTEGRATION === '1' ? test : test.skip;
mediaTest('real media becomes a silent decodable H.264 preview below 10 MB and 30 seconds', () => {
  const source = join(root, 'original.mov');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=180x390:rate=12:duration=45',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=45', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-c:a', 'aac', source], { timeout: 10000 });
  rmSync(join(bin, 'ffmpeg')); rmSync(join(bin, 'ffprobe'));
  const result = invoke(0, ['--record-video'], { SIM_VIDEO_SOURCE: source });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('maestro diagnostic');
  expect(previews()).toHaveLength(1);
  const video = join(dir, previews()[0]!);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video], { encoding: 'utf8' }));
  expect(probe.streams).toHaveLength(1);
  expect(probe.streams[0]).toMatchObject({ codec_name: 'h264', codec_type: 'video', width: 360 });
  expect(Number(probe.format.duration)).toBeGreaterThan(29);
  expect(Number(probe.format.duration)).toBeLessThanOrEqual(30.1);
  expect(Number(probe.format.size)).toBeLessThan(10_000_000);
  expect(receipt()).toMatchObject({ status: 'saved', sourceSeconds: 45 });
  execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-frames:v', '1', '-f', 'null', '-'], { timeout: 3000 });
}, 20000);
