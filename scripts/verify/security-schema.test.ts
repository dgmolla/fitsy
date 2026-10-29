import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
const migrations = readdirSync(join(root, 'prisma/migrations')).sort().filter(name => name !== 'migration_lock.toml')
  .map(name => readFileSync(join(root, 'prisma/migrations', name, 'migration.sql'), 'utf8')).join('\n');
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
  .map(match => /@@map\("([^"]+)"\)/.exec(match[2]!)?.[1] ?? match[1]!);

test.each(models)('%s has versioned default-deny RLS', model => {
  expect(migrations).toContain(`ALTER TABLE public."${model}" ENABLE ROW LEVEL SECURITY;`);
  expect(migrations).not.toMatch(new RegExp(`ALTER TABLE (?:public\\.)?"${model}" DISABLE ROW LEVEL SECURITY`, 'i'));
});

test('current and future public tables cannot bypass API auth through client grants', () => {
  expect(migrations).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC');
  expect(migrations).toContain("rolname IN ('anon', 'authenticated')");
  expect(migrations).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I');
});

test('extension metadata is protected by schema grants without moving or taking ownership of PostGIS', () => {
  const migration = readFileSync(join(root, 'prisma/migrations/20261029000000_private_public_schema/migration.sql'), 'utf8');
  expect(migration).toContain('REVOKE USAGE ON SCHEMA public FROM PUBLIC');
  expect(migration).toContain("REVOKE USAGE ON SCHEMA public FROM %I");
  expect(migration).toContain("has_schema_privilege(client_role, 'public', 'USAGE')");
  expect(migration).toContain('RAISE EXCEPTION');
  expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  expect(migration).not.toMatch(/ALTER\s+(EXTENSION|TABLE)|OWNER\s+TO|DROP\s+|CREATE\s+POLICY/i);
});
