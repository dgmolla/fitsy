import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { chainItemMatches, checkpointMatches, cleanupReadTarget, parseOptions, restaurantMatches, tables } from './cleanup-test-fixtures';
import { DEV_PROJECT_REF, PROD_PROJECT_REF } from '../lib/db-target-guard';
import { compileChainProductBatch } from '../../apps/api/services/chainProductBatch';
const load = createRequire(__filename);
const april: typeof import('../../apps/api/tests/fixtures/__snapshots__/chain-pilot-april.json') = load('../../apps/api/tests/fixtures/__snapshots__/chain-pilot-april.json');
const qualityInput: typeof import('../../apps/api/services/chainCatalogs/chain-quality-2026-09-input.json') = load('../../apps/api/services/chainCatalogs/chain-quality-2026-09-input.json');

const counts = Object.fromEntries(tables.map(table => [table, 0]));
const prod = `postgresql://readonly:synthetic@db.${PROD_PROJECT_REF}.supabase.co/postgres`;
const dev = `postgresql://readonly:synthetic@db.${DEV_PROJECT_REF}.supabase.co/postgres`;

test('defaults to dry run and requires a complete, exact count manifest for apply', () => {
  expect(parseOptions([]).apply).toBe(false);
  expect(parseOptions(['--apply', `--expect=${JSON.stringify(counts)}`]).expect).toEqual(counts);
  for (const args of [['--apply'], ['--apply=true'], ['--apply', '--dry-run'], ['--prod', '--prod'],
    ['--url-env=unsafe-name'], ['--expect=oops'], ['--expect=[]'], ['--expect=null'],
    [`--expect=${JSON.stringify({ ...counts, Brand: -1 })}`], [`--expect=${JSON.stringify({ ...counts, Brand: 0.5 })}`],
    [`--expect=${JSON.stringify({ ...counts, Brand: '0' })}`], [`--expect=${JSON.stringify({ ...counts, extra: 0 })}`],
    ['--expect={"Restaurant":0}']]) expect(() => parseOptions(args)).toThrow();
});

test('read-only discovery accepts only the existing project routes', () => {
  expect(cleanupReadTarget(prod)).toBe(prod);
  expect(cleanupReadTarget(dev)).toBe(dev);
  expect(() => cleanupReadTarget('postgresql://readonly:synthetic@db.abcdefghijklmnopqrst.supabase.co/postgres')).toThrow(/allowlist/);
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

test('real CLI refuses a synthetic production route before driver construction, without leaking its password', async () => {
  const loopback = '127.0.0.1'; // loopback test fixture
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-cleanup-refusal-'));
  const log = join(directory, 'connections');
  try {
    const url = `postgresql://postgres.${PROD_PROJECT_REF}:password-marker@${loopback}:1/postgres`;
    const env: NodeJS.ProcessEnv = { ...process.env, POSTGRES_PRISMA_URL: url, FITSY_TEST_DB_CLIENT_LOG: log,
      NODE_OPTIONS: `--require=${resolve(__dirname, '../test-fixtures/database-client-recorder.cjs')}` };
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
    expect(output.text).not.toContain('password-marker'); expect(existsSync(log)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('checkpoints require a verified fixture scope and the exact suite-specific hex identity', () => {
  const scope = 'a32323a0-5c16-46d2-bda7-93c8320ee947';
  const pilot = { id: 'fixture-brand', scope, chain: 'waba-grill', slug: scope + 'waba-grill', displayName: scope + ' WaBa Grill', suite: 'pilot' as const };
  const checkpoint = { runId: scope, hexId: scope + 'waba-grill', count: 1 };
  expect(checkpointMatches(checkpoint, [pilot])).toBe(true);
  expect(checkpointMatches({ ...checkpoint, hexId: 'waba-grill' }, [{ ...pilot, suite: 'expansion' }])).toBe(true);
  expect(checkpointMatches(checkpoint, [])).toBe(false);
  expect(checkpointMatches({ ...checkpoint, hexId: 'waba-grill' }, [pilot])).toBe(false);
  expect(checkpointMatches({ ...checkpoint, count: 2 }, [pilot])).toBe(false);
  expect(checkpointMatches(checkpoint, [{ ...pilot, scope: 'b32323a0-5c16-46d2-bda7-93c8320ee947' }])).toBe(false);
});

test('packaged fixture identities require the exact compiled catalog key, chain, suite and parent brand', () => {
  const scope = 'a32323a0-5c16-46d2-bda7-93c8320ee947';
  const products = compileChainProductBatch(qualityInput).changes.filter(change => change.expected === null);
  expect(products.map(product => [product.slug, product.canonicalKey])).toEqual([
    ['waba-grill', 'packaged/pepsi/original/20-fl-oz'],
    ['waba-grill', 'packaged/gatorade/cool-blue/20-fl-oz'],
    ['waba-grill', 'packaged/gatorade/fruit-punch/20-fl-oz'],
    ['yoshinoya', 'packaged/gatorade/lime-cucumber/20-fl-oz'],
    ['waba-grill', 'packaged/pure-leaf/raspberry/16-9-fl-oz'],
    ['waba-grill', 'packaged/pure-leaf/unsweetened/16-9-fl-oz'],
    ['waba-grill', 'packaged/dole/apple-100-percent/15-2-fl-oz'],
    ['waba-grill', 'packaged/poppi/raspberry-rose/12-fl-oz'],
    ['waba-grill', 'packaged/poppi/strawberry-lemon/12-fl-oz'],
  ]);
  for (const product of products) {
    const brand = { id: 'fixture-' + product.slug, scope, chain: product.slug, slug: scope + product.slug,
      displayName: scope + product.slug, suite: 'expansion' as const };
    const row = { brandId: brand.id, canonicalKey: product.canonicalKey };
    expect(chainItemMatches(row, brand)).toBe(true);
    expect(chainItemMatches(row, { ...brand, chain: product.slug === 'waba-grill' ? 'yoshinoya' : 'waba-grill' })).toBe(false);
    expect(chainItemMatches(row, { ...brand, suite: 'pilot' })).toBe(false);
    expect(chainItemMatches({ ...row, brandId: 'live-brand' }, brand)).toBe(false);
    for (const key of [row.canonicalKey + '-other', row.canonicalKey.toUpperCase(), row.canonicalKey.replace('-fl-oz', '-oz')]) {
      expect(chainItemMatches({ ...row, canonicalKey: key }, brand)).toBe(false);
    }
  }
});
