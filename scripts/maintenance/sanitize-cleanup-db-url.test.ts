import { allowedParameters, assertDatabaseWriteAllowed, databaseTarget, PROD_PROJECT_REF } from '../lib/db-target-guard';
import { sanitizeCleanupDatabaseUrl } from './sanitize-cleanup-db-url';

// Parsing only: none of these synthetic routes opens a database connection.
const base = `postgresql://postgres.${PROD_PROJECT_REF}:synthetic@localhost:1/postgres`;
const reference = `reference=${PROD_PROJECT_REF}`;

test('keeps the guard allowlist, first values and connection identity without mutating the guard', async () => {
  const parameters = new URLSearchParams([...allowedParameters].map(key => [key, key === 'options' ? reference : 'first value']));
  const original = base + '?' + parameters + '&host=synthetic-secret&sslmode=second&%73chema=second';
  const result = sanitizeCleanupDatabaseUrl(original);
  expect([...new URL(result.url).searchParams]).toEqual([...parameters]);
  expect(result.droppedKeys).toEqual(['host', 'sslmode', 'schema']);
  expect(new URL(result.url).username).toBe(new URL(base).username);
  expect(new URL(result.url).password).toBe('synthetic');
  expect(new URL(result.url).host).toBe('localhost:1');
  expect(new URL(result.url).pathname).toBe('/postgres');
  expect(databaseTarget(result.url).ref).toBe(PROD_PROJECT_REF);
  expect(() => databaseTarget(original)).toThrow('unsupported database routing parameters');
  await expect(assertDatabaseWriteAllowed(result.url, { env: {}, args: [] })).rejects.toThrow('PRODUCTION requires');
});

test.each([
  '', '-csearch_path=public', reference + ' ', reference + '\n', reference + '\r',
  reference + '\u2028', reference.toUpperCase(), 'reference=' + 'a'.repeat(19),
  'reference=' + 'a'.repeat(21), 'reference=' + '_'.repeat(20),
])('drops an options value that is not exactly a project reference: %j', options => {
  const result = sanitizeCleanupDatabaseUrl(base + '?' + new URLSearchParams({ options }));
  expect(result).toEqual({ url: base, droppedKeys: ['options'] });
});

test('valid first options survives duplicates while an invalid first value cannot promote a later route', () => {
  const validFirst = sanitizeCleanupDatabaseUrl(base + '?' + new URLSearchParams([
    ['options', reference], ['options', 'reference=' + 'a'.repeat(20)],
  ]));
  expect(new URL(validFirst.url).searchParams.getAll('options')).toEqual([reference]);
  expect(validFirst.droppedKeys).toEqual(['options']);
  expect(sanitizeCleanupDatabaseUrl(base + '?' + new URLSearchParams([
    ['options', '-csearch_path=public'], ['options', reference],
  ]))).toEqual({ url: base, droppedKeys: ['options'] });
});

test('unknown names are dropped once and names, rather than values, are reported', () => {
  expect(sanitizeCleanupDatabaseUrl(base + '?unknown=synthetic-secret&unknown=other&sslMode=require'))
    .toEqual({ url: base, droppedKeys: ['unknown', 'sslMode'] });
});

test.each([
  base + '#fragment', 'https://localhost/postgres', 'postgresql://unidentified.invalid/postgres',
  base + '?' + new URLSearchParams({ options: 'reference=' + 'a'.repeat(20) }),
])('sanitization retains other route fields so the unchanged guard still refuses: %s', original => {
  expect(() => databaseTarget(sanitizeCleanupDatabaseUrl(original).url)).toThrow('DB_WRITE_REFUSED');
});

test.each([undefined, '', 'invalid-synthetic-secret'])('invalid input gets a credential-free error', original => {
  expect(() => sanitizeCleanupDatabaseUrl(original)).toThrow('Invalid cleanup database URL');
});
