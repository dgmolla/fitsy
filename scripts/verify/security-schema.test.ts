import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
const migrations = readdirSync(join(root, 'prisma/migrations')).sort().filter(name => name !== 'migration_lock.toml')
  .map(name => readFileSync(join(root, 'prisma/migrations', name, 'migration.sql'), 'utf8')).join('\n');
const models = [...schema.matchAll(/^model (\w+) \{/gm)].map(match => match[1]!);

test.each(models)('%s has versioned default-deny RLS', model => {
  expect(migrations).toContain(`ALTER TABLE public."${model}" ENABLE ROW LEVEL SECURITY;`);
  expect(migrations).not.toMatch(new RegExp(`ALTER TABLE (?:public\\.)?"${model}" DISABLE ROW LEVEL SECURITY`, 'i'));
});

test('current and future public tables cannot bypass API auth through client grants', () => {
  expect(migrations).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC');
  expect(migrations).toContain("rolname IN ('anon', 'authenticated')");
  expect(migrations).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I');
});
