import { Prisma, type PrismaClient } from '@prisma/client';
import { setTimeout } from 'node:timers/promises';

/** P2034 and raw-query SQLSTATE 40001 are known serialization aborts. Never retry an uncertain commit or a stale plan. */
export async function chainTransaction<T>(prisma: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>, timeout = 30_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout }); }
    catch (error) {
      const aborted = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === 'P2034' || (error.code === 'P2010' && error.meta?.['code'] === '40001'));
      if (!aborted || attempt === 2) throw error;
      await setTimeout(100 * (attempt + 1));
    }
  }
}
