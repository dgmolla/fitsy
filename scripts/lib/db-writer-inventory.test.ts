import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unguardedDatabaseWriters } from './db-writer-inventory';

const root = resolve(__dirname, '../..');
const config = ['scripts/jest.config.js', "module.exports = { globalSetup: '<rootDir>/lib/test-database-guard.ts' };"] as const;
const guard = "import { assertDevDatabase as checked, assertDatabaseWriteAllowed } from './lib/db-target-guard';\n";
const prisma = "import { PrismaClient as Database } from '@prisma/client';\n";
const check = (path: string, text: string, extra: [string, string][] = []) => unguardedDatabaseWriters(new Map([config, [path, text], ...extra]));

test('every API, script, SQL, shell and test client uses its actual guarded datasource', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const sources = new Map(files.filter(path => existsSync(resolve(root, path)))
    .filter(path => /\.(?:[cm]?[jt]sx?|sh|sql|ya?ml)$/.test(path) || path.endsWith('package.json') || path.startsWith('.githooks/'))
    .map(path => [path, readFileSync(resolve(root, path), 'utf8')]));
  expect(unguardedDatabaseWriters(sources)).toEqual([]);
});

test.each([
  ['scripts/new.ts', prisma + 'new Database();'],
  ['apps/api/new.ts', prisma + 'new Database();'],
  ['scripts/new.test.ts', prisma + 'new Database({ datasourceUrl: "postgresql://prod" });'],
  ['apps/api/new.test.ts', prisma + 'new Database({ datasourceUrl: "postgresql://prod" });'],
  ['scripts/new.test.ts', guard + prisma + 'new Database({ datasourceUrl: checked(process.env.URL) });'],
  ['scripts/new.ts', "import {assertRuntimeDatabase} from './lib/db-target-guard';\n" + prisma + 'new Database({ datasourceUrl: assertRuntimeDatabase(process.env.URL) });'],
  ['scripts/new.ts', "import * as db from '@prisma/client'; new db.PrismaClient();"],
  ['scripts/new.ts', "const {PrismaClient: DB} = require('@prisma/client'); new (DB as typeof DB)();"],
  ['scripts/new.ts', "const {PrismaClient: DB} = await import('@prisma/client'); new DB();"],
  ['scripts/new.ts', "import { Pool as DB } from 'pg'; new DB({connectionString: process.env.URL});"],
  ['scripts/new.ts', "import pg from 'pg'; new pg.Client();"],
  ['scripts/new.ts', "import sql from 'postgres'; sql(process.env.URL);"],
  ['apps/api/new.ts', "import {createClient as db} from '@supabase/supabase-js'; db(process.env.URL, process.env.KEY);"],
  ['scripts/new.sh', 'psql "$POSTGRES_PRISMA_URL" -c "UPDATE data SET x=1"'],
  ['scripts/new.sh', 'npx prisma migrate deploy'],
  ['scripts/new.mjs', "spawnSync('psql', ['-c', 'DELETE FROM data']);"],
  ['.github/workflows/new.yml', 'steps:\n  - run: psql "$URL" -f update.sql'],
  ['.github/workflows/new.yml', 'steps:\n  - run: "psql database -f update.sql"'],
  ['.githooks/new-hook', 'psql database -f update.sql'],
  ['package.json', JSON.stringify({ scripts: { write: 'npx prisma db execute --file=update.sql' } })],
  ['scripts/new.sql', 'UPDATE "MenuItem" SET calories = 0;'],
  ['scripts/new.sql', 'BEGIN READ ONLY; COMMIT; UPDATE data SET x=1; BEGIN READ ONLY; COMMIT;'],
])('new unguarded writers fail coverage: %s', (path, text) => {
  expect(check(path, text)).not.toEqual([]);
});

test.each([
  'const url = checked(process.env.DEV); new Database({ datasourceUrl: process.env.PROD, log: [url] });',
  'function checked(value) { return value; } new Database({ datasourceUrl: checked(process.env.PROD) });',
  'new Database({ datasourceUrl: assertDatabaseWriteAllowed(process.env.URL) });',
  'const url = checked(process.env.DEV); function unsafe() { const url = process.env.PROD; new Database({ datasourceUrl: url }); }',
  'const url = flag ? checked(process.env.DEV) : process.env.PROD; new Database({ datasourceUrl: url });',
  'let url = checked(process.env.DEV); url = process.env.PROD; new Database({ datasourceUrl: url });',
  'new Database({ datasourceUrl: checked(process.env.DEV), ...unsafeOptions });',
  'new Database({ datasourceUrl: checked(process.env.DEV), datasourceUrl: process.env.PROD });',
])('unrelated, shadowed, unawaited or partially guarded values fail', text => {
  expect(check('scripts/new.ts', guard + prisma + text)).not.toEqual([]);
});

test('only real guard imports and guarded target properties count', () => {
  expect(check('scripts/new.ts', prisma + "import { assertDevDatabase as checked } from './fake'; new Database({ datasourceUrl: checked(process.env.URL) });")).not.toEqual([]);
  expect(check('scripts/new.ts', guard + prisma + 'const url = checked(process.env.URL); new Database({datasources:{db:{url}}});')).toEqual([]);
  expect(check('scripts/new.ts', guard + prisma + 'new Database({datasourceUrl: await assertDatabaseWriteAllowed(process.env.URL)});')).toEqual([]);
});

test('the signed recovery target is awaited and scoped to its one maintenance caller', () => {
  const source = prisma + "import { recoveryTarget } from './hex-jobs-recovery-target';\n";
  const guarded = "new Database({datasourceUrl: await recoveryTarget('resolve')});";
  expect(check('scripts/deploy/recover-hex-jobs.ts', source + guarded)).toEqual([]);
  expect(check('scripts/deploy/recover-hex-jobs.ts', source + guarded.replace('await ', ''))).not.toEqual([]);
  expect(check('scripts/deploy/other.ts', source + guarded)).not.toEqual([]);
});

test('implicit Prisma test clients require the actual disposable-DB Jest setup; explicit overrides need their own guard', () => {
  expect(check('scripts/new.test.ts', prisma + 'new Database();')).toEqual([]);
  expect(check('scripts/new.test.ts', prisma + 'new Database();', [['scripts/jest.config.js', 'module.exports = {};']])).not.toEqual([]);
  expect(check('scripts/new.test.ts', "import {assertTestDatabase} from './lib/test-database-guard';\n" + prisma + 'new Database({datasourceUrl:assertTestDatabase(process.env.URL)});')).toEqual([]);
});

test('read-only exceptions cannot gain ORM or SQL mutations', () => {
  expect(check('scripts/ghost-sample.ts', prisma + 'const p = new Database(); p.user.deleteMany();')).not.toEqual([]);
  expect(check('scripts/ghost-sample.ts', prisma + 'const p = new Database(); p.$queryRaw`DELETE FROM users RETURNING id`;')).not.toEqual([]);
  expect(check('scripts/security/new.sql', 'BEGIN READ ONLY; SELECT 1; ROLLBACK;')).toEqual([]);
});
