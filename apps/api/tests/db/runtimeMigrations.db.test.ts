import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabase } from '../../../../scripts/lib/test-database-guard';
import { assertRuntimeMigrations, requiredRuntimeMigration } from '../../../../scripts/deploy/runtime-migrations-preflight';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;

suite('required runtime migrations (disposable PostgreSQL only)', () => {
  const url = process.env['POSTGRES_PRISMA_URL'];
  const admin = url ? new PrismaClient({ datasourceUrl: assertTestDatabase(url) }) : new PrismaClient();
  afterAll(() => admin.$disconnect());

  test('only one completed matching attempt establishes widget schema readiness', async () => {
    const rollback = new Error('rollback runtime-migration fixture');
    await expect(admin.$transaction(async tx => {
      await assertRuntimeMigrations(tx);
      const [applied] = await tx.$queryRaw<Array<{ id: string; checksum: string; finished_at: Date }>>`
        SELECT id, checksum, finished_at FROM public._prisma_migrations
        WHERE migration_name = ${requiredRuntimeMigration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      expect(applied).toBeDefined();
      expect(await tx.$queryRaw`SELECT to_regclass('public."WidgetToken"')::text AS name`)
        .toEqual([{ name: '"WidgetToken"' }]);

      const duplicate = randomUUID();
      await tx.$executeRaw`INSERT INTO public._prisma_migrations
        (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
        VALUES (${duplicate}, ${applied!.checksum}, ${requiredRuntimeMigration}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`;
      await expect(assertRuntimeMigrations(tx)).rejects.toThrow(/absent, incomplete or changed/);
      await tx.$executeRaw`DELETE FROM public._prisma_migrations WHERE id = ${duplicate}`;

      for (const [checksum, finished, rolledBack] of [
        ['0'.repeat(64), applied!.finished_at, null],
        [applied!.checksum, null, null],
        [applied!.checksum, applied!.finished_at, new Date()],
      ] as const) {
        await tx.$executeRaw`UPDATE public._prisma_migrations
          SET checksum = ${checksum}, finished_at = ${finished}, rolled_back_at = ${rolledBack}
          WHERE id = ${applied!.id}`;
        await expect(assertRuntimeMigrations(tx)).rejects.toThrow(/absent, incomplete or changed/);
      }
      await tx.$executeRaw`DELETE FROM public._prisma_migrations WHERE id = ${applied!.id}`;
      await expect(assertRuntimeMigrations(tx)).rejects.toThrow(/absent, incomplete or changed/);
      throw rollback;
    }, { timeout: 15_000 })).rejects.toBe(rollback);
    await assertRuntimeMigrations(admin);
  });
});
