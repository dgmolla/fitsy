/**
 * Phase 1 — landing (M6). Consolidates validated extraction rows into the final ChainItem
 * dataset and (gated) upserts them to the DB.
 *
 *   - Reads scripts/phase1-out/run/_coverage.json → official brands.
 *   - Loads each official brand's row file, keeps `valid` rows.
 *   - Resolves Brand.id by slug (read-only DB).
 *   - Writes the consolidated set to scripts/phase1-out/chainitems.json (always).
 *   - With --apply: upserts ChainItem on (brandId, canonicalKey). 🔴 GATED — needs human go
 *     AND the ChainItem model present in prisma/schema.prisma (+ `prisma generate`). Until then
 *     --apply is a no-op-with-warning; the dry run (default) just builds the local artifact.
 *
 * Run (dry, safe):  npx tsx --env-file=.env.local scripts/phase1-land.ts
 * Run (apply, GATED): npx tsx --env-file=.env.local scripts/phase1-land.ts --apply
 *
 * Runbook: docs/engineering/pipeline/phase1-extraction-execution.md → M6
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// aliases: prefer the VERIFIED, high-precision set (phase1-verify-aliases.ts) so what lands is
// safe to backfill; fall back to the raw aligner output only if verification hasn't run.
const ALIAS_PATH = existsSync("scripts/phase1-out/aliases-verified.json") ? "scripts/phase1-out/aliases-verified.json"
  : existsSync("scripts/phase1-out/aliases.json") ? "scripts/phase1-out/aliases.json" : null;
const ALIASES: Record<string, Record<string, string[]>> = ALIAS_PATH ? JSON.parse(readFileSync(ALIAS_PATH, "utf8")) : {};
if (ALIAS_PATH) console.log(`(aliases from ${ALIAS_PATH})`);

const RUN_DIR = "scripts/phase1-out/run";
const APPLY = process.argv.includes("--apply");
const p = new PrismaClient();

interface Row { name: string; servingSize: string | null; calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; canonicalKey: string; valid: boolean }
interface ChainItemOut { brandSlug: string; brandId: string | null; canonicalKey: string; aliases: string[]; name: string; servingSize: string | null; calories: number; proteinG: number; carbsG: number; fatG: number; source: "official"; confidence: "HIGH"; officialUrl: string | null }

async function main() {
  const cov = JSON.parse(readFileSync(join(RUN_DIR, "_coverage.json"), "utf8"));
  const official = cov.results.filter((r: any) => r.status === "official");
  // Brand slug → id (read-only)
  const brands = await p.brand.findMany({ select: { id: true, slug: true } });
  const idBySlug = new Map(brands.map((b) => [b.slug, b.id]));

  const out: ChainItemOut[] = [];
  let missingBrand = 0;
  for (const b of official) {
    const f = join(RUN_DIR, `${b.slug}.json`);
    if (!existsSync(f)) continue;
    const { rows } = JSON.parse(readFileSync(f, "utf8")) as { rows: Row[] };
    const brandId = idBySlug.get(b.slug) ?? null;
    if (!brandId) missingBrand++;
    for (const r of rows) {
      if (!r.valid || r.calories == null || r.proteinG == null || r.carbsG == null || r.fatG == null) continue;
      const aliases = ALIASES[b.slug]?.[r.canonicalKey] ?? [];
      out.push({ brandSlug: b.slug, brandId, canonicalKey: r.canonicalKey, aliases, name: r.name, servingSize: r.servingSize,
        calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG, source: "official", confidence: "HIGH", officialUrl: b.official });
    }
  }
  writeFileSync("scripts/phase1-out/chainitems.json", JSON.stringify({ count: out.length, brands: official.length, items: out }, null, 2));

  console.log(`=== ChainItem consolidation ===`);
  console.log(`  official brands     : ${official.length}`);
  console.log(`  validated items     : ${out.length}`);
  console.log(`  brands w/o Brand row: ${missingBrand}`);
  console.log(`  unique canonicalKeys: ${new Set(out.map((o) => o.brandSlug + "|" + o.canonicalKey)).size}`);
  console.log(`  total UE aliases    : ${out.reduce((a, o) => a + o.aliases.length, 0)} (runtime canon-first lookup keys)`);
  console.log(`  → scripts/phase1-out/chainitems.json`);

  if (APPLY) {
    const client = p as any;
    if (!client.chainItem) {
      console.warn(`\n  🔴 --apply requested but prisma.chainItem is absent.\n     Add the ChainItem model to schema.prisma + run \`prisma migrate dev --name add_chain_item\` first (M6 gate).`);
    } else {
      console.log(`\n  applying ${out.length} ChainItem upserts...`);
      let n = 0;
      for (const o of out) {
        if (!o.brandId) continue;
        await client.chainItem.upsert({
          where: { brandId_canonicalKey: { brandId: o.brandId, canonicalKey: o.canonicalKey } },
          create: { brandId: o.brandId, canonicalKey: o.canonicalKey, aliases: o.aliases, calories: Math.round(o.calories), proteinG: o.proteinG, carbsG: o.carbsG, fatG: o.fatG, servingSize: o.servingSize, source: o.source, confidence: o.confidence, officialUrl: o.officialUrl, retrievedAt: new Date() },
          update: { aliases: o.aliases, calories: Math.round(o.calories), proteinG: o.proteinG, carbsG: o.carbsG, fatG: o.fatG, source: o.source, confidence: o.confidence, officialUrl: o.officialUrl, retrievedAt: new Date() },
        });
        n++;
      }
      console.log(`  applied ${n} ChainItem rows.`);
    }
  } else {
    console.log(`\n  (dry run — no DB writes. Re-run with --apply after the M6 gate.)`);
  }
}
main().catch((e) => { console.error("LAND ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
