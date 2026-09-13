import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { applyCatalogPlan, planChainPilot } from "../../services/chainPilotPlan";

const configured = process.env["POSTGRES_PRISMA_URL"];
const suite = configured && ["localhost", "postgres"].includes(new URL(configured).hostname) ? describe : describe.skip;
const facts = { calories: 500, proteinG: 30, carbsG: 50, fatG: 20 };

suite("legacy classifier protection in disposable databases", () => {
  test.each([false, true])("legacy bootstrap refuses existing identities (reviewed catalog=%s)", async reviewed => {
    // The code under test can rewrite an entire database if its guard regresses.
    // Never run that writer against the shared test database, even under a fixture lock.
    const database = `fitsy_legacy_${randomUUID().replaceAll("-", "")}`;
    const admin = new PrismaClient({ datasources: { db: { url: configured! } } });
    const url = new URL(configured!); url.pathname = "/" + database;
    const root = resolve(__dirname, "../../../..");
    const env = { ...process.env, POSTGRES_PRISMA_URL: url.toString(), POSTGRES_URL_NON_POOLING: url.toString() };
    let local: PrismaClient | undefined, created = false;
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`); created = true;
      execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: root, env, stdio: "pipe" });
      local = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      const [target] = await local.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
      expect(target!.name).toBe(database);
      const displayName = "Fixture Reviewed Cafe";
      const brand = await local.brand.create({ data: { slug: "fixture-reviewed-cafe", displayName, detectionConf: "high", menuKind: "restaurant" } });
      const restaurants = await Promise.all([0, 1].map(() => local!.restaurant.create({ data: {
        name: displayName, brandId: brand.id, storeUuid: randomUUID(), address: "Synthetic", lat: 34, lng: -118, cuisineTags: [], source: "fixture" } })));
      const names = ["Chicken breast (1 oz)", "Chicken thigh (1 oz)", "Chicken leg (1 oz)", "Chicken wing (1 oz)", "Chicken tender (1 oz)"];
      await local.menuItem.createMany({ data: restaurants.flatMap(r => names.map(name => ({ restaurantId: r.id, name, ...facts }))) });
      if (reviewed) {
        const catalog = { version: 1 as const, reviewedBy: "Synthetic legacy-writer regression", changes: [{ slug: brand.slug, canonicalKey: "chicken",
          expected: null, facts: { ...facts, servingSize: "synthetic test serving" }, source: { url: "https://example.com/fixture", sha256: "1".repeat(64) },
          locator: "Synthetic software test, not nutrition ground truth", aliases: [{ name: names[0]! }] }], quarantine: [] };
        await applyCatalogPlan(local, planChainPilot([brand], [], catalog), catalog);
      }
      const cli = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", "scripts/phase0-populate-brands.ts", ...args], {
        cwd: root, env: { ...env, POSTGRES_PRISMA_URL: "postgresql://unused@localhost:1/must_not_be_used" }, stdio: "pipe" }).toString();
      const dryRun = cli();
      expect(dryRun).toContain("DRY RUN");
      expect(dryRun).toMatch(/retail brands:\s+1/);
      expect(dryRun).toContain("2 restaurants get menuKind != restaurant");
      expect(() => cli("--apply")).toThrow("Brand identities already exist");
      expect(await local.brand.findUniqueOrThrow({ where: { id: brand.id } })).toEqual(brand);
      expect(await local.restaurant.findMany({ orderBy: { id: "asc" } })).toEqual(restaurants.sort((a, b) => a.id.localeCompare(b.id)));
      expect(await local.menuItem.count()).toBe(10);
    } finally {
      await local?.$disconnect();
      if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}"`);
      await admin.$disconnect();
    }
  }, 125_000);
});
