import { Prisma, type ChainItem } from "@prisma/client";
import { chainSnapshotInput } from "./snapshot-row";
const row = { id: "catalog-row", brandId: "waba", canonicalKey: "chicken-plate", aliases: [], servingSize: "1 plate", calories: 820,
  proteinG: 54, carbsG: 110, fatG: 15, source: "official", confidence: "HIGH", officialUrl: "https://example.com/nutrition.pdf", retrievedAt: new Date(), createdAt: new Date(), updatedAt: new Date() } as ChainItem;
test("pre-review snapshots remain unchanged", () => { expect(chainSnapshotInput(row)).toEqual(row); });
test("database null becomes Prisma DbNull rather than JSON null", () => {
  expect(chainSnapshotInput({ ...row, review: null } as ChainItem)).toEqual({ ...row, review: Prisma.DbNull });
});
test("review objects survive snapshot copying", () => {
  const review = { version: 1, aliases: [{ name: "Chicken Plate" }] };
  expect(chainSnapshotInput({ ...row, review } as ChainItem)).toEqual({ ...row, review });
});
