import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient, type Brand } from "@prisma/client";
import { chainPilot } from "../../services/chainPilotData";
import { stateHash } from "../../services/chainPilotPlan";
import { rollbackAprilBatch } from "../../services/chainPilotRollback";
import { capturedChainPilot } from "../fixtures/chain-pilot";
const url = process.env["POSTGRES_PRISMA_URL"];
// CLI writes must never be exercised against a cloud or production database.
const suite = url && ["localhost", "postgres"].includes(new URL(url).hostname) ? describe : describe.skip;
suite("actual pilot CLI plan, apply and rollback", () => {
  const p = new PrismaClient(), root = resolve(__dirname, "../../../..");
  afterAll(async () => { await p.$disconnect(); });
  test("explicit hashes and target guard writes; complete workflow restores its captured starting state", async () => {
    await p.$transaction(async tx => {
      // Serialize this fixed-slug CLI fixture across mutation workers, without locking application rows.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(78343218)`;
      const brands: Brand[] = [], directory = mkdtempSync(join(tmpdir(), "fitsy-chain-cli-"));
      const run = (command: string, ...args: string[]) => JSON.parse(execFileSync(process.execPath,
        [require.resolve("tsx/cli"), "--tsconfig", join(root, "apps/api/tsconfig.json"), join(root, "scripts/preload-chain-pilot.ts"), command, ...args],
        { cwd: root, env: { ...process.env, POSTGRES_PRISMA_URL: url!, POSTGRES_URL_NON_POOLING: url! }, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").at(-1)!);
      try {
        expect(await p.brand.count({ where: { slug: { in: ["waba-grill", "yoshinoya"] } } })).toBe(0);
        for (const slug of ["waba-grill", "yoshinoya"]) brands.push(await p.brand.create({ data: { slug, displayName: slug === "waba-grill" ? "WaBa Grill" : "Yoshinoya", detectionConf: "high" } }));
        for (const row of [...chainPilot.changes, ...chainPilot.quarantine]) if (row.expected) await p.chainItem.create({ data: { brandId: brands.find(b => b.slug === row.slug)!.id, ...row.expected } });
        for (const capture of capturedChainPilot) {
          const restaurant = await p.restaurant.create({ data: { storeUuid: directory + capture.slug, name: capture.name, address: "CLI fixture", lat: 34, lng: -118, cuisineTags: [], source: "ue_feed", brandId: brands.find(b => b.slug === capture.slug)!.id } });
          const item = await p.menuItem.create({ data: { restaurantId: restaurant.id, ...capture.april, photoUrl: "https://example.com/photo", price: 10, dietaryTags: ["fixture-tag"] } });
          await p.macroEstimate.create({ data: { menuItemId: item.id, source: "haiku", confidence: "MEDIUM", calories: capture.april.calories, proteinG: capture.april.proteinG, carbsG: capture.april.carbsG, fatG: capture.april.fatG } });
        }
        // Sort a non-canary first so removing either ordering or the batch limit fails.
        const location = await p.restaurant.findFirstOrThrow({ where: { brandId: brands[0]!.id } });
        const extra = await p.menuItem.create({ data: { id: "000-" + directory, restaurantId: location.id, ...capturedChainPilot[0]!.april, name: "Steak Plate", section: "Beef", description: "" } });
        await p.macroEstimate.create({ data: { menuItemId: extra.id, source: "haiku", confidence: "MEDIUM", calories: extra.calories!, proteinG: extra.proteinG!, carbsG: extra.carbsG!, fatG: extra.fatG! } });
        const rejected = await p.restaurant.create({ data: { storeUuid: directory + "unresolved", name: "WaBa Grill #1234", brandId: brands[0]!.id, address: "CLI fixture", lat: 34, lng: -118, cuisineTags: [], source: "ue_feed" } });
        await p.menuItem.create({ data: { restaurantId: rejected.id, ...capturedChainPilot[0]!.april } });
        const query = { where: { restaurant: { brandId: { in: brands.map(b => b.id) } } }, include: { macroEstimates: { orderBy: { id: "asc" as const } } }, orderBy: { id: "asc" as const } };
        const before = await p.menuItem.findMany(query), catalogPath = join(directory, "catalog.json"), aprilPath = join(directory, "april.json");
        const plan = run("catalog-plan", catalogPath);
        expect(plan.changes).toBe(12);
        expect(statSync(catalogPath).mode & 0o777).toBe(0o600);
        expect(() => run("april-plan", aprilPath)).toThrow("Apply and verify the catalog pilot first");
        expect(() => run("catalog-apply", catalogPath, "wrong")).toThrow("plan hash mismatch");
        const wrongTarget = join(directory, "wrong-target.json"), parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
        writeFileSync(wrongTarget, JSON.stringify({ ...parsed, target: "wrong" }));
        expect(() => run("catalog-apply", wrongTarget, plan.hash)).toThrow("Database target");
        expect(await p.chainItem.count({ where: { brandId: { in: brands.map(b => b.id) } } })).toBe(9);
        expect(run("catalog-apply", catalogPath, plan.hash).applied).toBe(12);
        expect(() => run("catalog-apply", catalogPath, plan.hash)).toThrow("EEXIST");
        const april = run("april-plan", aprilPath); expect(april.matched).toBe(3);
        expect(april.unresolvedRestaurants).toEqual([{ id: rejected.id, name: rejected.name, brandId: brands[0]!.id }]);
        expect(JSON.parse(readFileSync(aprilPath, "utf8")).rows.map((row: { approved: { canonicalKey: string } }) => row.approved.canonicalKey)).toEqual(["chicken-plate", "gyudon-beef-side", "steak-plate"]);
        const intactPlan = readFileSync(aprilPath, "utf8"), tampered = JSON.parse(intactPlan);
        tampered.rows.reverse(); writeFileSync(aprilPath, JSON.stringify(tampered));
        try { expect(() => run("april-apply", aprilPath, april.hash, "--limit=2")).toThrow("intact April plan"); }
        finally { writeFileSync(aprilPath, intactPlan); }
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(before));
        for (const limit of ["0", "99", "abc", "1.5"]) expect(() => run("april-apply", aprilPath, april.hash, "--limit=" + limit)).toThrow("Invalid apply limit");
        expect(run("april-apply", aprilPath, april.hash, "--limit=2")).toMatchObject({ applied: 2, remainingInPlan: 1 });
        const after = await p.menuItem.findMany(query), canary = before.find(item => item.name === "Chicken Plate" && item.restaurantId !== rejected.id)!;
        expect(after.filter(m => m.macroEstimates.some(e => e.source === "official")).map(m => m.calories).sort((a, b) => a! - b!)).toEqual([310, 820]);
        expect(stateHash(after.find(item => item.id === extra.id))).toBe(stateHash(before.find(item => item.id === extra.id)));
        expect(readdirSync(aprilPath + ".journal").filter(name => /^\d+\.json$/.test(name))).toHaveLength(2);
        expect(statSync(join(aprilPath + ".journal", "started.json")).mode & 0o777).toBe(0o600);
        expect(() => run("april-apply", aprilPath, april.hash, "--limit=2")).toThrow("EEXIST");
        expect(run("april-plan", join(directory, "replan.json")).matched).toBe(1);
        await p.macroEstimate.updateMany({ where: { menuItemId: canary.id, source: "official" }, data: { hadPhoto: true } });
        expect(run("april-plan", join(directory, "metadata-replan.json")).matched).toBe(2);
        await p.macroEstimate.updateMany({ where: { menuItemId: canary.id, source: "official" }, data: { hadPhoto: false } });
        const correctCanary = await p.menuItem.findUniqueOrThrow({ where: { id: canary.id } });
        await p.menuItem.update({ where: { id: canary.id }, data: { calories: correctCanary.calories! + 1 } });
        expect(run("april-plan", join(directory, "denorm-replan.json")).matched).toBe(2);
        await p.menuItem.update({ where: { id: canary.id }, data: { calories: correctCanary.calories, updatedAt: correctCanary.updatedAt } });
        for (const [command, input, record] of [["april-rollback", aprilPath + ".journal", join(aprilPath + ".journal", "started.json")], ["catalog-rollback", catalogPath + ".applied.json", catalogPath + ".applied.json"]] as const) {
          const original = readFileSync(record, "utf8"); writeFileSync(record, JSON.stringify({ ...JSON.parse(original), target: "wrong" }));
          try { expect(() => run(command, input)).toThrow("Database target"); } finally { writeFileSync(record, original); }
        }
        const intact = stateHash(await p.menuItem.findMany(query));
        for (const [source, alternative] of [["1.json", "1.saved"], ["1.json", "2.json"], ["0.json", "0.saved"]] as const) {
          const journalRow = join(aprilPath + ".journal", source), renamed = join(aprilPath + ".journal", alternative); renameSync(journalRow, renamed);
          try { expect(() => run("april-rollback", aprilPath + ".journal")).toThrow("Incomplete April rollback evidence"); } finally { renameSync(renamed, journalRow); }
          expect(stateHash(await p.menuItem.findMany(query))).toBe(intact);
        }
        // The edited first canary rolls back last: refusing it must also undo the preceding rollback.
        const beforeEdit = await p.menuItem.findUniqueOrThrow({ where: { id: canary.id } });
        await p.menuItem.update({ where: { id: canary.id }, data: { name: "Later edit" } });
        const edited = stateHash(await p.menuItem.findMany(query));
        expect(() => run("april-rollback", aprilPath + ".journal")).toThrow("April row changed after apply");
        expect(stateHash(await p.menuItem.findMany(query))).toBe(edited);
        await p.menuItem.update({ where: { id: canary.id }, data: { name: beforeEdit.name, updatedAt: beforeEdit.updatedAt } });
        expect(run("april-rollback", aprilPath + ".journal")).toEqual({ rolledBack: 2, expected: 2 });
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(before));
        // A later stale row stops before its write; earlier committed rows remain safely reversible.
        const partialPath = join(directory, "partial.json"), partial = run("april-plan", partialPath);
        const second = before.find(item => item.name !== "Chicken Plate" && item.id !== extra.id)!;
        const editedSecond = await p.menuItem.update({ where: { id: second.id }, data: { name: "Concurrent edit" } });
        expect(() => run("april-apply", partialPath, partial.hash, "--limit=2")).toThrow("April item changed");
        expect(await p.macroEstimate.count({ where: { menuItemId: canary.id, source: "official" } })).toBe(1);
        const stoppedPath = join(partialPath + ".journal", "stopped.json"), stoppedText = readFileSync(stoppedPath, "utf8");
        expect(JSON.parse(stoppedText).count).toBe(1);
        expect(statSync(stoppedPath).mode & 0o777).toBe(0o600);
        writeFileSync(stoppedPath, JSON.stringify({ ...JSON.parse(stoppedText), planHash: "wrong" }));
        try { expect(() => run("april-rollback", partialPath + ".journal")).toThrow("Invalid stopped-batch evidence"); }
        finally { writeFileSync(stoppedPath, stoppedText); }
        renameSync(stoppedPath, stoppedPath + ".saved");
        try { expect(() => run("april-rollback", partialPath + ".journal")).toThrow("Incomplete April rollback evidence"); }
        finally { renameSync(stoppedPath + ".saved", stoppedPath); }
        expect(run("april-rollback", partialPath + ".journal")).toEqual({ rolledBack: 1, expected: 1 });
        expect(await p.menuItem.findUniqueOrThrow({ where: { id: second.id } })).toEqual(editedSecond);
        await p.menuItem.update({ where: { id: second.id }, data: { name: second.name, updatedAt: second.updatedAt } });
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(before));
        // An unexpected DB write failure must not be certified as a known pre-write stop.
        const uncertainPath = join(directory, "uncertain.json"), uncertain = run("april-plan", uncertainPath);
        await p.$executeRawUnsafe(`ALTER TABLE "MacroEstimate" ADD CONSTRAINT chain_pilot_cli_failure CHECK ("menuItemId" <> '${second.id}' OR source <> 'official')`);
        try { expect(() => run("april-apply", uncertainPath, uncertain.hash, "--limit=2")).toThrow("Prisma"); }
        finally { await p.$executeRawUnsafe('ALTER TABLE "MacroEstimate" DROP CONSTRAINT chain_pilot_cli_failure'); }
        expect(readdirSync(uncertainPath + ".journal")).not.toContain("stopped.json");
        expect(() => run("april-rollback", uncertainPath + ".journal")).toThrow("Incomplete April rollback evidence");
        // Explicit inspection establishes the one saved write; this is intentionally manual recovery.
        expect(await p.menuItem.findUniqueOrThrow({ where: { id: second.id }, include: { macroEstimates: { orderBy: { id: "asc" } } } })).toEqual(second);
        await rollbackAprilBatch(p, [JSON.parse(readFileSync(join(uncertainPath + ".journal", "0.json"), "utf8"))]);
        expect(stateHash(await p.menuItem.findMany(query))).toBe(stateHash(before));
        expect(run("catalog-rollback", catalogPath + ".applied.json").rolledBack).toBe(12);
        expect(await p.chainItem.count({ where: { brandId: { in: brands.map(b => b.id) } } })).toBe(9);
      } finally {
        const ids = brands.map(b => b.id);
        await p.restaurant.deleteMany({ where: { brandId: { in: ids } } });
        await p.chainItem.deleteMany({ where: { brandId: { in: ids } } });
        await p.brand.deleteMany({ where: { id: { in: ids } } });
        rmSync(directory, { recursive: true, force: true });
      }
    }, { timeout: 120_000, maxWait: 120_000 });
  }, 125_000);
});
