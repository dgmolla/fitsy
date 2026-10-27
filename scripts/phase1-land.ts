/**
 * Phase 1 — landing (M6). Consolidates validated extraction rows into the final ChainItem
 * proposal dataset. Database writes from this legacy entrypoint are disabled.
 *
 *   - Reads scripts/phase1-out/run/_coverage.json → official brands.
 *   - Loads each official brand's row file, keeps `valid` rows.
 *   - Resolves Brand.id by slug (read-only DB).
 *   - Requires the verifier's aliases-high.json for both dry runs and DB landing.
 *   - Writes the consolidated set to scripts/phase1-out/chainitems.json after validation.
 *   - --apply always refuses; use chainWriteGuard/chainPilotPlan through preload-chain-pilot.ts.
 *
 * Run (proposal only): npx tsx --env-file=.env.local scripts/phase1-land.ts
 *
 * Historical M6 runbook: docs/engineering/archive/phase1-extraction-execution.md
 * Current proposal scope: docs/engineering/pipeline/chain-rollout-proposals.md
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadVerifiedAliases } from "./phase1-alias-input";

if (process.argv.slice(2).some(arg => /^--apply(?:=|$)/.test(arg))) {
  console.error("DEPRECATED: phase1-land.ts --apply is disabled. Use the reviewed chainWriteGuard/chainPilotPlan path via preload-chain-pilot.ts; see docs/engineering/pipeline/chain-rollout-proposals.md.");
  process.exit(1);
}

// These legacy name aliases remain candidates, not ChainItem.review approval.
const ALIASES = loadVerifiedAliases("scripts/phase1-out");

const RUN_DIR = "scripts/phase1-out/run";
const p = new PrismaClient();

interface Row { name: string; servingSize: string | null; calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; alluloseG?: number | null; canonicalKey: string; valid: boolean }
interface ChainItemOut { brandSlug: string; brandId: string | null; canonicalKey: string; aliases: string[]; name: string; servingSize: string | null; calories: number; proteinG: number; carbsG: number; fatG: number; alluloseG?: number; source: "official"; confidence: "HIGH"; officialUrl: string | null }

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
        ...(r.alluloseG != null ? { alluloseG: r.alluloseG } : {}),
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

  console.log("Proposal only. Database application requires the reviewed chainWriteGuard/chainPilotPlan path via preload-chain-pilot.ts.");
}
main().catch((e) => { console.error("LAND ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
