import { Prisma, type ChainItem } from "@prisma/client";
/** Works across the additive review-column rollout, including snapshots made before it exists. */
export function chainSnapshotInput(row: Omit<ChainItem, "review"> & { review?: Prisma.JsonValue }): Prisma.ChainItemCreateManyInput {
  if ("review" in row) return { ...row, review: row.review === null ? Prisma.DbNull : row.review as Prisma.InputJsonValue } as Prisma.ChainItemCreateManyInput;
  return row as Prisma.ChainItemCreateManyInput;
}
