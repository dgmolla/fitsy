/**
 * Phase 0 — populate the Brand table + Restaurant.brandId / .menuKind.
 * Re-runs v3 detection, folds in LLM tiebreaker verdicts (scripts/phase0-tiebreak.json),
 * then WRITES. Touches ONLY: INSERT Brand, UPDATE Restaurant.{brandId,menuKind}.
 * Asserts MenuItem / MacroEstimate counts are unchanged. Idempotent (upsert by slug).
 *
 *   --apply   actually write (default is dry-run)
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
const p = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const MIN_ITEMS = 5, PAIR_CAP = 30, DIST_BEST = 0.5, DIST_REVIEW = 0.3, GEN_BEST = 0.6, GEN_REVIEW = 0.45, ISOLATED = 0.2, DISTINCT_TOKEN_MAXFREQ = 2;
const GAZ = new Set(["los-angeles","la","hollywood","glendale","pasadena","burbank","santa-monica","long-beach","downtown","dtla","koreatown","ktown","echo-park","silver-lake","venice","culver-city","west-la","sherman-oaks","van-nuys","north-hollywood","noho","west-hollywood","weho","beverly-hills","torrance","redondo-beach","el-segundo","inglewood","westwood","brentwood"]);
const NAME_STOP = new Set(["the","of","and","by","a","an"]);
const ITEM_STOP = new Set(["the","a","an","of","with","w","and","in","on","for","your","our","my","x"]);
const DESCRIPTOR = new Set(["thai","chinese","mexican","italian","japanese","korean","vietnamese","indian","american","mediterranean","greek","french","cali","california","hawaiian","asian","latin","cuban","peruvian","salvadoran","new","york","tandoori","pizza","pizzeria","taco","tacos","burger","burgers","sushi","ramen","poke","boba","bubble","tea","coffee","chicken","wok","noodle","noodles","bbq","sandwich","sandwiches","donut","donuts","doughnut","ice","cream","juice","fish","seafood","kabab","kebab","wings","pho","curry","rice","bowl","bowls","bakery","dumpling","fries","smoothie","crepe","crepes","creperia","acai","teriyaki","kitchen","house","shop","cafe","bar","restaurant","eatery","bistro","market","markets","spot","place","corner","garden","grill","express","fresh","original","famous","food","foods","dishes","cuisine","deli"]);

function normalizeBrand(raw: string): string {
  let s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[®™©]/g, " ");
  s = s.replace(/\(.*?\)/g, " ").replace(/#\s*\d+/g, " ").replace(/\bno\.?\s*\d+\b/g, " ");
  s = s.split(/\s[-–]\s|\s@\s|\bat\b/)[0]!.replace(/\b(llc|inc|co|corp|ltd)\b/g, " ");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  let parts = s.split("-");
  while (parts.length > 1 && GAZ.has(parts[parts.length - 1]!)) parts.pop();
  return parts.join("-");
}
function itemKey(raw: string): string {
  let s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/#\s*\d+/g, " ");
  s = s.replace(/\b\d+\s*(?:pc|pcs|piece|pieces|oz|ct|count)\b/g, " ").replace(/\b\d+\/\d+\b/g, " ").replace(/\bw\//g, " ");
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  return s.split(/\s+/).filter((t) => t && !ITEM_STOP.has(t) && !/^\d+$/.test(t)).sort().join(" ");
}
const SKU = /\(?\b\d+(\.\d+)?\s?(fl\s?oz|oz|ml|l|gal|lbs?|ct|count|pk|pack|grams?|kg|mg)\b|\b\d+\s?x\s?\d+\b|\(\d+\s+\w+\)/i;
const DISH = /\b(roll|plate|bowl|soup|taco|burrito|burger|sandwich|wrap|latte|doughnut|donut|pizza|noodle|ramen|kabob|kebab|salad|fries|nugget|combo|curry|rice|pho|sushi)\b/i;
const PET = ["dog food","cat food","cat litter","dog treat","cat treat","kibble","whisker city","lickable"];
const PHARM = ["ibuprofen","tylenol","advil","vitamin","emergen-c","bandage","cough","shampoo","toothpaste","melatonin"];
const LIQ = ["sauvignon","cabernet","chardonnay","merlot","pinot","champagne","whiskey","vodka","tequila","bourbon","lager","brut","prosecco","moet","veuve"];
function menuKind(items: string[]): string {
  if (!items.length) return "restaurant";
  const rate = (t: (s: string) => boolean) => items.filter(t).length / items.length;
  if (rate((s) => PET.some((w) => s.includes(w))) >= 0.1) return "pet";
  if (rate((s) => PHARM.some((w) => s.includes(w))) >= 0.1) return "pharmacy";
  if (rate((s) => LIQ.some((w) => s.includes(w))) >= 0.2) return "liquor";
  if (rate((s) => SKU.test(s)) >= 0.4 && rate((s) => DISH.test(s)) < 0.3) return "grocery/convenience";
  return "restaurant";
}
const containment = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.min(a.size, b.size);
};

async function main() {
  console.log(APPLY ? "=== APPLY MODE (writing) ===" : "=== DRY RUN (use --apply to write) ===");
  const before = { menuItems: await p.menuItem.count(), macros: await p.macroEstimate.count(), rests: await p.restaurant.count() };
  console.log(`snapshot: ${before.rests} restaurants, ${before.menuItems} items, ${before.macros} macros`);

  const rests = await p.restaurant.findMany({ select: { id: true, name: true } });
  const itemRows = await p.$queryRaw<{ restaurantId: string; names: string[] }[]>`
    SELECT "restaurantId", array_agg(name) AS names FROM "MenuItem" GROUP BY "restaurantId"`;
  const keysByRest = new Map<string, Set<string>>();
  const kindByRest = new Map<string, string>();
  for (const r of itemRows) {
    keysByRest.set(r.restaurantId, new Set(r.names.map(itemKey)));
    kindByRest.set(r.restaurantId, menuKind(r.names.map((n) => n.toLowerCase().trim())));
  }

  const clusters = new Map<string, { name: string; ids: string[] }>();
  for (const r of rests) {
    const slug = normalizeBrand(r.name);
    if (!slug) continue;
    if (!clusters.has(slug)) clusters.set(slug, { name: r.name, ids: [] });
    clusters.get(slug)!.ids.push(r.id);
  }
  const tokFreq = new Map<string, number>();
  for (const slug of clusters.keys())
    for (const t of new Set(slug.split("-").filter((x) => x && !NAME_STOP.has(x) && !/^\d+$/.test(x))))
      tokFreq.set(t, (tokFreq.get(t) ?? 0) + 1);
  const isDistinctive = (slug: string) => {
    const toks = slug.split("-").filter((x) => x && !NAME_STOP.has(x) && !/^\d+$/.test(x));
    if (!toks.length) return false;
    return Math.min(...toks.map((t) => tokFreq.get(t) ?? 99)) <= DISTINCT_TOKEN_MAXFREQ || toks.some((t) => !DESCRIPTOR.has(t));
  };

  // LLM tiebreaker verdicts by slug
  const verdicts = new Map<string, any>();
  if (existsSync("scripts/phase0-tiebreak.json")) {
    for (const r of JSON.parse(readFileSync("scripts/phase0-tiebreak.json", "utf8")).results)
      if (r.llm) verdicts.set(r.slug, r.llm);
  }
  console.log(`loaded ${verdicts.size} LLM verdicts`);

  // Decide brands
  type BrandPlan = { slug: string; display: string; memberIds: string[]; menuKind: string; bestPair: number; distinctive: boolean; conf: string };
  const plans: BrandPlan[] = [];
  const retailKindOverride = new Map<string, string>(); // restaurantId -> retail kind (from verdict)

  for (const [slug, { name, ids }] of clusters) {
    if (ids.length < 2) continue;
    const scored = ids.filter((id) => (keysByRest.get(id)?.size ?? 0) >= MIN_ITEMS);
    if (scored.length < 2) continue;
    const cap = scored.slice(0, PAIR_CAP);
    const sets = cap.map((id) => keysByRest.get(id)!);
    let bestPair = 0; const maxToOthers = new Array(sets.length).fill(0);
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      const c = containment(sets[i]!, sets[j]!); bestPair = Math.max(bestPair, c);
      maxToOthers[i] = Math.max(maxToOthers[i], c); maxToOthers[j] = Math.max(maxToOthers[j], c);
    }
    const distinctive = isDistinctive(slug);
    const v = verdicts.get(slug);

    // membership (admitted): distinctive → all; generic → drop true odd-ducks
    let memberIds = ids;
    let klass: "chain" | "review" | "no";
    if (distinctive) klass = bestPair >= DIST_BEST ? "chain" : bestPair >= DIST_REVIEW ? "review" : "no";
    else {
      if (bestPair >= GEN_BEST) {
        klass = "chain";
        const drop = new Set(cap.filter((_, i) => maxToOthers[i] < ISOLATED));
        memberIds = ids.filter((id) => !drop.has(id));
      } else klass = bestPair >= GEN_REVIEW ? "review" : "no";
    }

    // fold tiebreaker: promote review when LLM confirms same_brand; respect retail
    let conf = klass === "chain" ? "high" : "review";
    let isChain = klass === "chain";
    if (v?.same_brand && (klass === "chain" || klass === "review")) { isChain = true; if (klass !== "chain") conf = "llm-confirmed"; }
    if (!isChain) continue;

    // menuKind for the brand + members
    let mkind: string;
    const kinds = scored.map((id) => kindByRest.get(id) ?? "restaurant");
    const kc = new Map<string, number>(); for (const k of kinds) kc.set(k, (kc.get(k) ?? 0) + 1);
    const detKind = [...kc.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    if (v?.is_retail) { mkind = v.retail_kind || "grocery/convenience"; for (const id of memberIds) retailKindOverride.set(id, mkind); }
    else mkind = detKind;

    const display = (v?.canonical_name && String(v.canonical_name).trim()) || name;
    plans.push({ slug, display, memberIds, menuKind: mkind, bestPair: Math.round(bestPair * 100) / 100, distinctive, conf });
  }

  // per-restaurant final menuKind (all restaurants; retail overrides from verdicts)
  const finalKind = new Map<string, string>();
  for (const r of rests) finalKind.set(r.id, retailKindOverride.get(r.id) ?? kindByRest.get(r.id) ?? "restaurant");

  const chainMembers = plans.reduce((s, b) => s + b.memberIds.length, 0);
  const nonRestaurant = [...finalKind.values()].filter((k) => k !== "restaurant").length;
  console.log(`\nplan: ${plans.length} brands, ${chainMembers} restaurants get brandId`);
  console.log(`      ${nonRestaurant} restaurants get menuKind != restaurant`);
  console.log(`      retail brands: ${plans.filter((b) => b.menuKind !== "restaurant").length}`);

  if (!APPLY) {
    console.log("\nsample brands:");
    for (const b of plans.slice(0, 8)) console.log(`  ${b.display.padEnd(26)} members=${b.memberIds.length} kind=${b.menuKind} conf=${b.conf}`);
    console.log("\nDRY RUN — no writes. Re-run with --apply.");
    await p.$disconnect(); return;
  }

  // ---- WRITE (Brand + Restaurant.brandId/menuKind only) ----
  let brandsWritten = 0;
  for (const b of plans) {
    const brand = await p.brand.upsert({
      where: { slug: b.slug },
      create: { slug: b.slug, displayName: b.display, locationCount: b.memberIds.length, menuKind: b.menuKind, bestPair: b.bestPair, distinctive: b.distinctive, detectionConf: b.conf },
      update: { displayName: b.display, locationCount: b.memberIds.length, menuKind: b.menuKind, bestPair: b.bestPair, distinctive: b.distinctive, detectionConf: b.conf },
    });
    await p.restaurant.updateMany({ where: { id: { in: b.memberIds } }, data: { brandId: brand.id } });
    brandsWritten++;
  }
  // menuKind for all non-restaurant restaurants, grouped by kind, chunked
  const byKind = new Map<string, string[]>();
  for (const [id, k] of finalKind) if (k !== "restaurant") (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(id);
  let kindUpdated = 0;
  for (const [k, ids] of byKind)
    for (let i = 0; i < ids.length; i += 500) {
      const r = await p.restaurant.updateMany({ where: { id: { in: ids.slice(i, i + 500) } }, data: { menuKind: k } });
      kindUpdated += r.count;
    }
  console.log(`\nwrote ${brandsWritten} brands; set menuKind on ${kindUpdated} restaurants`);

  // ---- assert no impact to existing tables ----
  const after = { menuItems: await p.menuItem.count(), macros: await p.macroEstimate.count(), rests: await p.restaurant.count() };
  const ok = after.menuItems === before.menuItems && after.macros === before.macros && after.rests === before.rests;
  console.log(`\nintegrity: items ${before.menuItems}→${after.menuItems}, macros ${before.macros}→${after.macros}, rests ${before.rests}→${after.rests}  ${ok ? "✓ UNCHANGED" : "✗ CHANGED!"}`);
  const brandCount = await p.brand.count();
  const withBrand = await p.restaurant.count({ where: { brandId: { not: null } } });
  console.log(`final: ${brandCount} brands, ${withBrand} restaurants linked`);
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
