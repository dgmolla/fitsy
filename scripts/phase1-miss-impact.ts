/**
 * Phase 1 — macro impact of the verified-run wrong matches. For each, show the UE item's
 * CURRENT macros (what users see today) vs the SWAPPED-IN wrongly-matched official macro, and
 * the delta — i.e. how bad the error would be if backfilled.
 *   npx tsx --env-file=.env.local scripts/phase1-miss-impact.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
const p = new PrismaClient();

// wrong pairs from the verified 89% run: [brandSlug, UE name, official name (as in ChainItem source)]
const PAIRS: [string, string, string][] = [
  ["boba-time", "Lavender Milk Tea", "Lavender Horchata Milk Tea - Regular"],
  ["boba-time", "Strawberry Matcha Late", "Strawberry Matcha Milk Tea - Regular"],
  ["fresh-brothers", "Chicken Caesar Salad", "Caesar Salad"],
  ["fresh-brothers", "Vegan Fresh Vegetable Original Crust - Large", "Fresh Vegetable Large (2 Pieces - 1/8 Pizza)"],
  ["fresh-brothers", "Skinny Vegan Fresh Vegetable - Medium", "Fresh Vegetable Medium (2 Pieces - 1/6 Pizza)"],
  ["banda-burrito", "Extra Side of Salsa", "Side of Salsa"],
  ["banda-burrito", "Add Avocado", "Avocado"],
  ["waba-grill", "Shrimp Veggie Bowl", "Shrimp"],
  ["waba-grill", "Chicken Plate", "Chicken"],
];

async function main() {
  const ci = JSON.parse(readFileSync("scripts/phase1-out/chainitems.json", "utf8")).items as any[];
  const offByName = new Map<string, any>();
  for (const it of ci) offByName.set(it.brandSlug + "|" + it.name.toLowerCase(), it);

  console.log("UE item (current Haiku est)  →  swapped official  |  Δcalories");
  console.log("".padEnd(96, "-"));
  let big = 0;
  for (const [slug, ue, off] of PAIRS) {
    const cur = await p.menuItem.findFirst({ where: { restaurant: { brandRef: { slug } }, name: ue }, select: { calories: true, proteinG: true, carbsG: true, fatG: true } });
    const o = offByName.get(slug + "|" + off.toLowerCase());
    if (!cur || !o) { console.log(`  (lookup miss) ${ue}  /  ${off}`); continue; }
    const dc = (o.calories ?? 0) - (cur.calories ?? 0);
    if (Math.abs(dc) >= 150) big++;
    const f = (c: any) => `${c.calories ?? "?"}cal P${c.proteinG ?? "?"} C${c.carbsG ?? "?"} F${c.fatG ?? "?"}`;
    console.log(`  ${ue.slice(0, 38).padEnd(38)}`);
    console.log(`     current : ${f(cur)}`);
    console.log(`     swapped : ${f(o)}   →  Δ ${dc > 0 ? "+" : ""}${dc} cal ${Math.abs(dc) >= 150 ? "  ⚠ BIG" : ""}`);
  }
  console.log(`\n  ${big}/${PAIRS.length} wrong matches shift calories by >=150 (materially misleading).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
