import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { chainTransaction } from '../../services/chainTransaction';
const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
suite('chain transaction conflict recovery', () => {
  const p = new PrismaClient();
  afterAll(async () => p.$disconnect());
  test.each(['orm', 'raw'])('%s concurrent serializable writes retry the aborted transaction and retain both updates', async mode => {
    const slug = 'conflict-' + randomUUID(), attempts = [0, 0];
    const brand = await p.brand.create({ data: { slug, displayName: slug, locationCount: 0 } });
    let firstReads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    try {
      await Promise.all([0, 1].map(i => chainTransaction(p, async tx => {
        attempts[i]!++;
        const before = await tx.brand.findUniqueOrThrow({ where: { id: brand.id } });
        if (attempts[i] === 1) { firstReads++; if (firstReads === 2) release(); await bothRead; }
        if (mode === 'raw') await tx.$executeRaw`UPDATE "Brand" SET "locationCount" = ${before.locationCount + 1} WHERE id = ${brand.id}`;
        else await tx.brand.update({ where: { id: brand.id }, data: { locationCount: before.locationCount + 1 } });
      })));
      expect(attempts.reduce((a, b) => a + b)).toBeGreaterThan(2);
      expect((await p.brand.findUniqueOrThrow({ where: { id: brand.id } })).locationCount).toBe(2);
    } finally { await p.brand.delete({ where: { id: brand.id } }); }
  });
  test('bounded retries roll back writes; stale plans and unknown errors run once', async () => {
    const slug = 'retry-bound-' + randomUUID(), brand = await p.brand.create({ data: { slug, displayName: slug } });
    try {
      for (const [error, expected] of [[new Error('stale plan'), 1],
        [new Prisma.PrismaClientKnownRequestError('uncertain result', { code: 'P2028', clientVersion: '6' }), 1],
        [new Prisma.PrismaClientKnownRequestError('raw serialization', { code: 'P2010', meta: { code: '40001' }, clientVersion: '6' }), 3],
        [new Prisma.PrismaClientKnownRequestError('other SQL error', { code: 'P2010', meta: { code: '42601' }, clientVersion: '6' }), 1],
        [new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: '6' }), 3]] as const) {
        let calls = 0;
        await expect(chainTransaction(p, async tx => {
          calls++; await tx.brand.update({ where: { id: brand.id }, data: { locationCount: 9 } }); throw error;
        })).rejects.toBe(error);
        expect(calls).toBe(expected);
        expect((await p.brand.findUniqueOrThrow({ where: { id: brand.id } })).locationCount).toBe(0);
      }
    } finally { await p.brand.delete({ where: { id: brand.id } }); }
  });
});
