import { databaseTarget } from './database';
import { PROD_PROJECT_REF } from '../../../../scripts/dev/lib/guard';

test('database audit refuses production even when a generic dev override is set', () => {
  const previous = process.env['FITSY_ALLOW_PROD'];
  try {
    process.env['FITSY_ALLOW_PROD'] = '1';
    expect(() => databaseTarget(`postgresql://postgres:fixture@db.${PROD_PROJECT_REF}.supabase.co:5432/postgres`, `https://${PROD_PROJECT_REF}.supabase.co`)).toThrow('PRODUCTION');
    expect(() => databaseTarget('postgresql://postgres:fixture@db.otherdev.supabase.co:5432/postgres', `https://${PROD_PROJECT_REF}.supabase.co`)).toThrow(/DB_WRITE_REFUSED/);
  } finally {
    if (previous === undefined) delete process.env['FITSY_ALLOW_PROD'];
    else process.env['FITSY_ALLOW_PROD'] = previous;
  }
});

test('database audit accepts loopback and matching dev projects, rejects mismatches', () => {
  const local = 'postgresql://fixture:fixture@localhost:5432/performance'; // loopback test fixture
  expect(databaseTarget(local, undefined)).toBe(local);
  const direct = 'postgresql://postgres:fixture@db.kegycybiruksmrzvniha.supabase.co:5432/postgres';
  const pooler = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-0-us-west-1.pooler.supabase.com:5432/postgres';
  for (const target of [direct, pooler]) expect(databaseTarget(target, 'https://kegycybiruksmrzvniha.supabase.co')).toBe(target);
  for (const target of [direct, pooler]) expect(() => databaseTarget(target, 'https://anotherproject.supabase.co')).toThrow('belong');
  expect(() => databaseTarget('https://dev.fitsy.org', 'https://kegycybiruksmrzvniha.supabase.co')).toThrow('PostgreSQL');
  expect(() => databaseTarget(undefined, undefined)).toThrow('not set');
});
