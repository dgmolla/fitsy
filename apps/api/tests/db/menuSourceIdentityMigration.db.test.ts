import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
const directory = resolve(__dirname, '../../../../prisma/migrations/20261024120000_source_item_identity');
// Execute the actual DDL in an isolated fixture schema within the test's transaction.
const statements = (file: string) => readFileSync(resolve(directory, file), 'utf8').replace(/^--.*$/gm, '')
  .split(';').map(sql => sql.trim()).filter(sql => sql && !/^(BEGIN|COMMIT)$/i.test(sql));
suite('menu identity migration preserves existing IDs and refuses lossy rollback', () => {
  const p = new PrismaClient();
  afterAll(async () => { await p.$disconnect(); });
  test('migration and pristine rollback preserve dish, saved reference and estimate IDs', async () => {
    const schema = 'identity_' + randomUUID().replace(/-/g, '');
    await p.$transaction(async tx => {
      await tx.$executeRaw(Prisma.raw(`CREATE SCHEMA "${schema}"`));
      await tx.$executeRaw(Prisma.raw(`SET LOCAL search_path TO "${schema}"`));
      await tx.$executeRaw`CREATE TABLE "MenuItem" (id TEXT PRIMARY KEY, "restaurantId" TEXT NOT NULL, name TEXT NOT NULL,
        CONSTRAINT "MenuItem_restaurantId_name_key" UNIQUE ("restaurantId", name))`;
      await tx.$executeRaw`CREATE TABLE "SavedItem" (id TEXT PRIMARY KEY, "menuItemId" TEXT REFERENCES "MenuItem"(id) ON DELETE SET NULL)`;
      await tx.$executeRaw`CREATE TABLE "MacroEstimate" (id TEXT PRIMARY KEY, "menuItemId" TEXT REFERENCES "MenuItem"(id), calories INT)`;
      await tx.$executeRaw`INSERT INTO "MenuItem" VALUES ('logged-dish', 'LA', 'Pasta')`;
      await tx.$executeRaw`INSERT INTO "SavedItem" VALUES ('saved', 'logged-dish')`;
      await tx.$executeRaw`INSERT INTO "MacroEstimate" VALUES ('estimate', 'logged-dish', 400)`;
      const snapshot = () => tx.$queryRaw`SELECT s.id, s."menuItemId", e.id AS "estimateId", e.calories
        FROM "SavedItem" s JOIN "MacroEstimate" e ON e."menuItemId" = s."menuItemId"`;
      const before = await snapshot();
      for (const sql of statements('migration.sql')) await tx.$executeRawUnsafe(sql);
      expect(await snapshot()).toEqual(before);
      for (const sql of statements('down.sql')) await tx.$executeRawUnsafe(sql);
      expect(await snapshot()).toEqual(before);
      for (const sql of statements('migration.sql')) await tx.$executeRawUnsafe(sql);
      await tx.$executeRaw`INSERT INTO "MenuItem" (id, "restaurantId", name, "sourceItemId") VALUES
        ('individual', 'LA', 'Pasta', 'ubereats:individual'), ('family', 'LA', 'Pasta', 'ubereats:family')`;
      await tx.$executeRaw`SAVEPOINT rollback_guard`;
      await expect(tx.$executeRawUnsafe(statements('down.sql')[1]!)).rejects.toThrow();
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT rollback_guard`;
      expect(await snapshot()).toEqual(before);
      expect(await tx.$queryRaw`SELECT count(*)::int AS count FROM "MenuItem"`).toEqual([{ count: 3 }]);
      await tx.$executeRaw`SAVEPOINT unique_guard`;
      await expect(tx.$executeRaw`INSERT INTO "MenuItem" (id, "restaurantId", name, "sourceItemId")
        VALUES ('duplicate', 'LA', 'Renamed pasta', 'ubereats:family')`).rejects.toThrow();
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT unique_guard`;
      await tx.$executeRaw`SAVEPOINT fallback_guard`;
      await expect(tx.$executeRaw`INSERT INTO "MenuItem" (id, "restaurantId", name) VALUES ('fallback-duplicate', 'LA', 'Pasta')`).rejects.toThrow();
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT fallback_guard`;
      await tx.$executeRaw(Prisma.raw(`DROP SCHEMA "${schema}" CASCADE`));
    });
  });
});
