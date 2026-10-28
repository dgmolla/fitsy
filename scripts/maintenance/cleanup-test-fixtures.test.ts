import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { cleanupTarget, parseOptions, restaurantMatches, tables } from './cleanup-test-fixtures';
import { DEV_PROJECT_REF, PROD_PROJECT_REF } from '../lib/db-target-guard';

const counts = Object.fromEntries(tables.map(table => [table, 0]));
const prod = `postgresql://readonly:synthetic@db.${PROD_PROJECT_REF}.supabase.co/postgres`;
const dev = `postgresql://readonly:synthetic@db.${DEV_PROJECT_REF}.supabase.co/postgres`;
const april: typeof import('../../apps/api/tests/fixtures/__snapshots__/chain-pilot-april.json') = require('../../apps/api/tests/fixtures/__snapshots__/chain-pilot-april.json');

test('defaults to dry run and requires a complete, exact count manifest for apply', () => {
  expect(parseOptions([]).apply).toBe(false);
  expect(parseOptions(['--apply', `--expect=${JSON.stringify(counts)}`]).expect).toEqual(counts);
  for (const args of [['--apply'], ['--apply=true'], ['--apply', '--dry-run'], ['--prod', '--prod'],
    ['--url-env=unsafe-name'], ['--expect=oops'], ['--expect=[]'], ['--expect=null'],
    [`--expect=${JSON.stringify({ ...counts, Brand: -1 })}`], [`--expect=${JSON.stringify({ ...counts, Brand: 0.5 })}`],
    [`--expect=${JSON.stringify({ ...counts, Brand: '0' })}`], [`--expect=${JSON.stringify({ ...counts, extra: 0 })}`],
    ['--expect={"Restaurant":0}']]) expect(() => parseOptions(args)).toThrow();
});

test('read-only production discovery does not grant write authority', () => {
  expect(cleanupTarget(prod, parseOptions([]), {})).toBe(prod);
  expect(cleanupTarget(dev, parseOptions(['--url-env=dev_db_readonly_url']), {})).toBe(dev);
  const apply = parseOptions(['--apply', `--expect=${JSON.stringify(counts)}`]);
  for (const [env, options] of [[{}, apply], [{ FITSY_ALLOW_PROD_WRITE: '1', GITHUB_ACTIONS: 'true' }, apply],
    [{ FITSY_ALLOW_PROD_WRITE: '1' }, { ...apply, prod: true }]] as const) {
    expect(() => cleanupTarget(prod, options, env)).toThrow(/DB_WRITE_REFUSED/);
  }
  // This only exercises the existing guard with synthetic URLs; it never connects.
  expect(cleanupTarget(prod, { ...apply, prod: true }, { FITSY_ALLOW_PROD_WRITE: '1', GITHUB_ACTIONS: 'true' })).toBe(prod);
  expect(() => cleanupTarget('postgresql://readonly:synthetic@db.abcdefghijklmnopqrst.supabase.co/postgres', parseOptions([]))).toThrow(/allowlist/);
});

test('exact compound fixture identities exclude normal locations, address collisions and foreign brand links', () => {
  const scope = 'a32323a0-5c16-46d2-bda7-93c8320ee947';
  const pilot = { id: 'fixture-brand', scope, chain: 'waba-grill', slug: scope + 'waba-grill', displayName: scope + ' WaBa Grill', suite: 'pilot' as const };
  const expansion = { ...pilot, displayName: scope + 'waba-grill', suite: 'expansion' as const };
  const base = { id: 'fixture-restaurant', name: pilot.displayName, storeUuid: scope, address: 'Rollback fixture', brandId: pilot.id, source: 'ue_feed', lat: 34, lng: -118 };
  expect(restaurantMatches(base, pilot)).toBe(true);
  expect(restaurantMatches({ ...base, address: 'New hex fixture', name: pilot.displayName + ' (New Location)', storeUuid: scope + pilot.id, brandId: null }, pilot)).toBe(true);
  expect(restaurantMatches({ ...base, address: 'New hex fixture', name: expansion.displayName + ' (New Location)', storeUuid: scope + 'new-waba-grill', brandId: null }, expansion)).toBe(true);
  expect(restaurantMatches({ ...base, id: scope, name: expansion.displayName, address: 'Captured variant', storeUuid: scope + scope }, expansion)).toBe(true);
  for (const edit of [{ name: 'WaBa Grill' }, { storeUuid: scope + 'other' }, { address: '123 Real Street' },
    { lat: 35 }, { lng: -117 }, { source: 'google' }, { brandId: 'live-brand' }, { brandId: null }]) {
    expect(restaurantMatches({ ...base, ...edit }, pilot)).toBe(false);
  }
  expect(restaurantMatches({ ...base, address: 'Captured fixture' }, pilot)).toBe(false);
  expect(restaurantMatches({ ...base, address: 'Captured variant' }, expansion)).toBe(false);
  for (const fixture of april) {
    const brand = { ...pilot, chain: fixture.slug, slug: scope + fixture.slug,
      displayName: scope + (fixture.slug === 'waba-grill' ? ' WaBa Grill' : ' Yoshinoya') };
    const row = { ...base, address: 'Captured fixture', storeUuid: scope + fixture.restaurantId, name: scope + ' ' + fixture.restaurantName };
    expect(restaurantMatches(row, brand)).toBe(true);
    expect(restaurantMatches({ ...row, storeUuid: fixture.restaurantId }, brand)).toBe(false);
  }
});

test('real CLI refuses a synthetic production route before opening a socket, without leaking its password', async () => {
  const loopback = '127.0.0.1'; // loopback test fixture
  let connections = 0;
  const server = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(done => server.listen(0, loopback, done));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture port');
    const url = `postgresql://postgres.${PROD_PROJECT_REF}:password-marker@${loopback}:${address.port}/postgres`;
    const env: NodeJS.ProcessEnv = { ...process.env, POSTGRES_PRISMA_URL: url };
    delete env['FITSY_ALLOW_PROD_WRITE']; delete env['GITHUB_ACTIONS']; delete env['VERCEL'];
    const output = await new Promise<{ code: number | null; text: string }>((done, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/maintenance/cleanup-test-fixtures.ts', '--apply', '--expect=' + JSON.stringify(counts)], {
        cwd: resolve(__dirname, '../..'), env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI preflight timed out')); }, 8000);
      child.stdout.on('data', data => text += data); child.stderr.on('data', data => text += data);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); done({ code, text }); });
    });
    expect(output.code).toBe(1); expect(output.text).toContain('DB_WRITE_REFUSED');
    expect(output.text).not.toContain('password-marker'); expect(connections).toBe(0);
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
