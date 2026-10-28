import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertRuntimeDatabase, DEV_PROJECT_REF, PROD_PROJECT_REF } from '../lib/db-target-guard';

const url = (ref: string) => `postgresql://fitsy_app.${ref}:synthetic@localhost:1/postgres`;
const auth = (ref: string) => `https://${ref}.supabase.co`;

test.each([DEV_PROJECT_REF, PROD_PROJECT_REF])('runtime accepts the same DB/Auth project: %s', ref => {
  expect(assertRuntimeDatabase(url(ref), auth(ref))).toBe(url(ref));
});
test.each([DEV_PROJECT_REF, PROD_PROJECT_REF])('existing postgres bindings retain exact DB/Auth identity until provisioning: %s', ref => {
  const legacy = url(ref).replace('fitsy_app.', 'postgres.');
  expect(assertRuntimeDatabase(legacy, auth(ref))).toBe(legacy);
  expect(() => assertRuntimeDatabase(legacy, auth(ref === DEV_PROJECT_REF ? PROD_PROJECT_REF : DEV_PROJECT_REF))).toThrow(/DB\/Auth project mismatch/);
});
test.each([[PROD_PROJECT_REF, auth(DEV_PROJECT_REF)], [DEV_PROJECT_REF, auth(PROD_PROJECT_REF)],
  [PROD_PROJECT_REF, undefined], [PROD_PROJECT_REF, auth(PROD_PROJECT_REF) + '.attacker.invalid'],
  [PROD_PROJECT_REF, auth(PROD_PROJECT_REF) + '?routing=synthetic-secret']])(
  'runtime refuses a missing or foreign Auth project', (ref, authUrl) => {
    expect(() => assertRuntimeDatabase(url(ref!), authUrl)).toThrow(/DB\/Auth project mismatch/);
    try { assertRuntimeDatabase(url(ref!), authUrl); } catch (error) { expect(String(error)).not.toContain('synthetic'); }
  });
test('local fixtures retain local and DEV Auth without a production exception', () => {
  const local = 'postgresql://fixture:synthetic@localhost:1/fitsy_verify';
  for (const target of [undefined, auth(DEV_PROJECT_REF), 'http://localhost:54321']) expect(assertRuntimeDatabase(local, target)).toBe(local);
  expect(() => assertRuntimeDatabase(local, auth(PROD_PROJECT_REF))).toThrow(/DB\/Auth project mismatch/);
});

test('an unconfigured import cannot fall back to Prisma environment-file credentials', () => {
  expect(assertRuntimeDatabase(undefined)).toBe('unconfigured-database://missing-POSTGRES_PRISMA_URL');
});

test('runtime reload discards a cached client bound to another database', () => {
  const source = `const stale = {}; globalThis.prisma = stale;
globalThis.fitsyPrismaDatasourceUrl = ${JSON.stringify(url(PROD_PROJECT_REF))};
const {prisma} = require('./apps/api/lib/restaurantService');
if (prisma === stale) throw new Error('reused a foreign datasource');
prisma.$disconnect().then(() => process.stdout.write('rebound to the checked target'));`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', source], {
    cwd: resolve(__dirname, '../..'), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, POSTGRES_PRISMA_URL: url(DEV_PROJECT_REF), SUPABASE_URL: auth(DEV_PROJECT_REF), NODE_OPTIONS: '' },
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('rebound to the checked target');
});

test.each([DEV_PROJECT_REF, PROD_PROJECT_REF])('actual production-mode runtime imports accept an existing postgres binding: %s', ref => {
  const source = `const {prisma} = require('./apps/api/lib/restaurantService');
require('./apps/api/lib/supabase').getSupabaseClient();
prisma.$disconnect().then(() => process.stdout.write('legacy binding validated'));`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', source], {
    cwd: resolve(__dirname, '../..'), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_ENV: 'production', POSTGRES_PRISMA_URL: url(ref).replace('fitsy_app.', 'postgres.'),
      SUPABASE_URL: auth(ref), SUPABASE_ANON_KEY: 'synthetic-anon-key', NODE_OPTIONS: '' },
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  expect(result.stdout).toContain('legacy binding validated');
});

test.each(['apps/api/lib/restaurantService.ts', 'apps/api/lib/supabase.ts'])('actual runtime %s aborts mixed projects before a client can connect', file => {
  const source = file.endsWith('supabase.ts')
    ? `require('./${file}').getSupabaseClient()` : `require('./${file}')`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', source], {
    cwd: resolve(__dirname, '../..'), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, POSTGRES_PRISMA_URL: url(PROD_PROJECT_REF), SUPABASE_URL: auth(DEV_PROJECT_REF),
      SUPABASE_ANON_KEY: 'synthetic-anon-key', NODE_OPTIONS: '' },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('DB/Auth project mismatch');
  expect(result.stderr).not.toContain('synthetic@');
  expect(result.stderr).not.toContain("Can't reach database");
});
