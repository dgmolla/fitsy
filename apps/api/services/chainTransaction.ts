import { Prisma, type PrismaClient } from '@prisma/client';
import { setTimeout } from 'node:timers/promises';

/** Only P2034 guarantees a write-conflict abort. Never retry an uncertain commit or a stale plan. */
export async function chainTransaction<T>(prisma: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>, timeout = 30_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2) throw error;
      await setTimeout(100 * (attempt + 1));
    }
  }
}
