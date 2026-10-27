import { Prisma, PrismaClient } from '@prisma/client';

const describeIfDb = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
describeIfDb('server-only application data (real Postgres)', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  test('all application models have RLS and no PUBLIC, anon or authenticated table grants', async () => {
    const models = Prisma.dmmf.datamodel.models.map(model => model.dbName ?? model.name);
    const rows = await prisma.$queryRaw<{ name: string; rls: boolean; clientGrants: bigint }[]>`
      SELECT c.relname AS name, c.relrowsecurity AS rls,
        (SELECT count(*) FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
          LEFT JOIN pg_roles r ON r.oid = acl.grantee
          WHERE acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated')) AS "clientGrants"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    for (const model of models) {
      expect(rows.find(row => row.name === model)).toEqual({ name: model, rls: true, clientGrants: 0n });
    }
    // The server connection still reads the same data after RLS is enabled.
    await expect(prisma.restaurant.count()).resolves.toBeGreaterThanOrEqual(0);
  });
});
