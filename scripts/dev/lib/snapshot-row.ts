import { Prisma, type ChainItem, type Restaurant } from "@prisma/client";
/** Works across the additive review-column rollout, including snapshots made before it exists. */
export function chainSnapshotInput(row: Omit<ChainItem, "review"> & { review?: Prisma.JsonValue }): Prisma.ChainItemCreateManyInput {
  if ("review" in row) return { ...row, review: row.review === null ? Prisma.DbNull : row.review as Prisma.InputJsonValue } as Prisma.ChainItemCreateManyInput;
  return row as Prisma.ChainItemCreateManyInput;
}

/** Preserve unknown hours as database NULL when copying real data into the guarded dev target. */
export function restaurantSnapshotInput(row: Omit<Restaurant, 'openingHours'> & { openingHours?: Prisma.JsonValue }): Prisma.RestaurantCreateManyInput {
  const { openingHours, ...base } = row;
  return openingHours === undefined ? base : { ...base, openingHours: openingHours === null ? Prisma.DbNull : openingHours as Prisma.InputJsonValue };
}
