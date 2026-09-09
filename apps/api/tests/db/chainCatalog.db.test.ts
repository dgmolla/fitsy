import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { buildChainMatcher, chainReviewHash } from "../../services/chainCatalog";
import { macroWinnerSqlOrder, pickWinningEstimate } from "@fitsy/shared";
const suite = process.env["POSTGRES_PRISMA_URL"] ? describe : describe.skip;
suite("reviewed chain catalog persistence", () => {
  const p = new PrismaClient(), brandId = randomUUID();
  beforeAll(async () => { await p.brand.create({ data: { id: brandId, slug: brandId, displayName: "Catalog fixture" } }); });
  afterAll(async () => { await p.chainItem.deleteMany({ where: { brandId } }); await p.brand.delete({ where: { id: brandId } }); await p.$disconnect(); });
  test("legacy rows start unreviewed; approved source + alias survives JSONB round trip", async () => {
    const row = await p.chainItem.create({ data: { brandId, canonicalKey: "plates/chicken", servingSize: "1 plate", // gitleaks:allow — fixture dish identity, not a credential
      calories: 820, proteinG: 54, carbsG: 110, fatG: 15, source: "official", confidence: "HIGH", officialUrl: "https://www.wabagrill.com/nutritional-guide" } });
    const item = { name: "Chicken Plate", section: "Plates" };
    expect(row.review).toBeNull();
    expect(buildChainMatcher([row])(brandId, item)).toEqual({ status: "unmatched" });
    const review = { version: 1 as const, sourceHash: "a".repeat(64), locator: "page 1 Plates Chicken", reviewedBy: "fixture", aliases: [item] };
    await p.chainItem.update({ where: { id: row.id }, data: { review: { ...review, dataHash: chainReviewHash(row, review) } } });
    const stored = await p.chainItem.findMany({ where: { brandId } });
    expect(buildChainMatcher(stored)(brandId, item)).toMatchObject({ status: "matched", row: { calories: 820, proteinG: 54 } });
    await p.chainItem.update({ where: { id: row.id }, data: { calories: 1050 } });
    expect(buildChainMatcher(await p.chainItem.findMany({ where: { brandId } }))(brandId, item)).toEqual({ status: "unmatched" });
  });
  test("SQL and TypeScript prefer merchant, then official, then other sources regardless of recency", async () => {
    const rows = ["haiku", "ffn", "fatsecret", "official", "merchant"].map((source, index) => ({ source, estimatedAt: new Date(2026, 1, 6 - index) }));
    const ordered = await p.$queryRaw<{ source: string }[]>`SELECT e.source FROM (VALUES
      ('haiku', '2026-02-06'::timestamp), ('ffn', '2026-02-05'::timestamp), ('fatsecret', '2026-02-04'::timestamp),
      ('official', '2026-02-03'::timestamp), ('merchant', '2026-02-02'::timestamp)
    ) e(source, "estimatedAt") ORDER BY ${Prisma.raw(macroWinnerSqlOrder("e"))}`;
    expect(ordered.map(r => r.source)).toEqual(["merchant", "official", "fatsecret", "ffn", "haiku"]);
    expect(pickWinningEstimate(rows)?.source).toBe(ordered[0]!.source);
    expect(pickWinningEstimate(rows.filter(r => r.source !== "merchant"))?.source).toBe("official");
  });
});
