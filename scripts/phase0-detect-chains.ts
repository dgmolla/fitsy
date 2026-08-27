/**
 * Phase 0 — chain detection (read-only), v3.
 *  - normalize name -> brandSlug; items -> itemKey (lightweight)
 *  - pairwise CONTAINMENT (intersection / smaller menu) on normalized keys
 *  - drop stub menus before scoring
 *  - ASYMMETRIC, multi-signal decision:
 *      distinctive name -> name licenses membership; confirm if best-pair >= floor; admit ALL
 *      generic name     -> per-member: largest connected component at high containment;
 *                          odd-ducks (members outside the component) split off
 *  - menuKind per restaurant (SKU vs dish) -> separate retail from restaurant chains
 * READ-ONLY: no writes, no schema changes.
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
const p = new PrismaClient();

const MIN_ITEMS = 5;
const PAIR_CAP = 30;        // cap members in pairwise matrix (big chains are distinctive → best-pair via sample)
const DIST_BEST = 0.5;      // distinctive: best-pair floor to confirm a real multi-loc brand
const DIST_REVIEW = 0.3;    // distinctive: below this best-pair → review
const GEN_BEST = 0.6;       // generic: best-pair floor to confirm a real chain
const GEN_REVIEW = 0.45;    // generic: below this best-pair → review
const ISOLATED = 0.2;       // a member matching nobody above this is an odd-duck → split off
const DISTINCT_TOKEN_MAXFREQ = 2;

// descriptor words: cuisine / food / venue. A name is GENERIC only if ALL its tokens
// are descriptors (e.g. "thai kitchen", "ice cream shop"). A non-descriptor token
// ("bell" in taco-bell, "hut" in pizza-hut, "panda") makes it distinctive.
const DESCRIPTOR = new Set([
  "thai","chinese","mexican","italian","japanese","korean","vietnamese","indian","american","mediterranean","greek","french","cali","california","hawaiian","asian","latin","cuban","peruvian","salvadoran","new","york","tandoori",
  "pizza","pizzeria","taco","tacos","burger","burgers","sushi","ramen","poke","boba","bubble","tea","coffee","chicken","wok","noodle","noodles","bbq","sandwich","sandwiches","donut","donuts","doughnut","ice","cream","juice","fish","seafood","kabab","kebab","wings","pho","curry","rice","bowl","bowls","bakery","dumpling","fries","smoothie","crepe","crepes","creperia","acai","teriyaki","kitchen",
  "house","shop","cafe","bar","restaurant","eatery","bistro","market","markets","spot","place","corner","garden","grill","kitchen","express","fresh","original","famous","food","foods","dishes","cuisine","deli",
]);

const GAZ = new Set(["los-angeles","la","hollywood","glendale","pasadena","burbank","santa-monica","long-beach","downtown","dtla","koreatown","ktown","echo-park","silver-lake","venice","culver-city","west-la","sherman-oaks","van-nuys","north-hollywood","noho","west-hollywood","weho","beverly-hills","torrance","redondo-beach","el-segundo","inglewood","westwood","brentwood"]);
const NAME_STOP = new Set(["the","of","and","by","a","an"]);
const ITEM_STOP = new Set(["the","a","an","of","with","w","and","in","on","for","your","our","my","x"]);

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
// menuKind signals
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
  const sku = rate((s) => SKU.test(s)), dish = rate((s) => DISH.test(s));
  if (sku >= 0.4 && dish < 0.3) return "grocery/convenience";
  return "restaurant";
}

const containment = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let i = 0; for (const x of a) if (b.has(x)) i++;
  return i / Math.min(a.size, b.size);
};

async function main() {
  const rests = await p.restaurant.findMany({ select: { id: true, name: true, chainFlag: true } });
  const itemRows = await p.$queryRaw<{ restaurantId: string; names: string[] }[]>`
    SELECT "restaurantId", array_agg(name) AS names FROM "MenuItem" GROUP BY "restaurantId"`;
  const keysByRest = new Map<string, Set<string>>();
  const kindByRest = new Map<string, string>();
  for (const r of itemRows) {
    const lower = r.names.map((n) => n.toLowerCase().trim());
    keysByRest.set(r.restaurantId, new Set(r.names.map(itemKey)));
    kindByRest.set(r.restaurantId, menuKind(lower));
  }

  type M = { id: string; chainFlag: boolean };
  const clusters = new Map<string, { name: string; members: M[] }>();
  for (const r of rests) {
    const slug = normalizeBrand(r.name);
    if (!slug) continue;
    if (!clusters.has(slug)) clusters.set(slug, { name: r.name, members: [] });
    clusters.get(slug)!.members.push({ id: r.id, chainFlag: r.chainFlag });
  }
  const tokFreq = new Map<string, number>();
  for (const slug of clusters.keys())
    for (const t of new Set(slug.split("-").filter((x) => x && !NAME_STOP.has(x) && !/^\d+$/.test(x))))
      tokFreq.set(t, (tokFreq.get(t) ?? 0) + 1);
  const isDistinctive = (slug: string) => {
    const toks = slug.split("-").filter((x) => x && !NAME_STOP.has(x) && !/^\d+$/.test(x));
    if (!toks.length) return false;
    // distinctive if it has a corpus-rare token OR a non-descriptor ("brand") token
    const rare = Math.min(...toks.map((t) => tokFreq.get(t) ?? 99)) <= DISTINCT_TOKEN_MAXFREQ;
    const hasBrandWord = toks.some((t) => !DESCRIPTOR.has(t));
    return rare || hasBrandWord;
  };

  type Row = { slug: string; display: string; locations: number; scored: number; distinctive: boolean;
    bestPair: number; admitted: number; splitOff: number; menuKind: string; flagged: number; klass: string };
  const rows: Row[] = [];
  for (const [slug, { name, members }] of clusters) {
    if (members.length < 2) continue;
    const scored = members.filter((m) => (keysByRest.get(m.id)?.size ?? 0) >= MIN_ITEMS);
    if (scored.length < 2) { rows.push({ slug, display: name, locations: members.length, scored: scored.length, distinctive: isDistinctive(slug), bestPair: 0, admitted: 0, splitOff: 0, menuKind: "restaurant", flagged: members.filter((m) => m.chainFlag).length, klass: "insufficient" }); continue; }
    const cap = scored.slice(0, PAIR_CAP);
    const sets = cap.map((m) => keysByRest.get(m.id)!);
    let bestPair = 0;
    const maxToOthers = new Array(sets.length).fill(0);
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      const c = containment(sets[i]!, sets[j]!);
      bestPair = Math.max(bestPair, c);
      maxToOthers[i] = Math.max(maxToOthers[i], c); maxToOthers[j] = Math.max(maxToOthers[j], c);
    }
    const isolated = maxToOthers.filter((c) => c < ISOLATED).length; // odd-ducks: match nobody
    const distinctive = isDistinctive(slug);
    // menuKind: majority over members
    const kinds = scored.map((m) => kindByRest.get(m.id) ?? "restaurant");
    const kindCount = new Map<string, number>();
    for (const k of kinds) kindCount.set(k, (kindCount.get(k) ?? 0) + 1);
    const mkind = [...kindCount.entries()].sort((a, b) => b[1] - a[1])[0]![0];

    let klass: string, admitted = 0, splitOff = 0;
    if (distinctive) {
      // name is near-unique → collisions implausible → admit all; confirm real via best-pair
      if (bestPair >= DIST_BEST) { klass = "chain"; admitted = members.length; }
      else if (bestPair >= DIST_REVIEW) klass = "review";
      else klass = "not-chain";
    } else {
      // generic → collision risk → need strong best-pair, and drop only true odd-ducks
      // (members that match NOBODY), not varied-but-real members
      if (bestPair >= GEN_BEST) { klass = "chain"; admitted = members.length - isolated; splitOff = isolated; }
      else if (bestPair >= GEN_REVIEW) klass = "review";
      else klass = "not-chain";
    }
    rows.push({ slug, display: name, locations: members.length, scored: scored.length, distinctive, bestPair, admitted, splitOff, menuKind: mkind, flagged: members.filter((m) => m.chainFlag).length, klass });
  }

  const chains = rows.filter((r) => r.klass === "chain");
  const restChains = chains.filter((r) => r.menuKind === "restaurant");
  const retailChains = chains.filter((r) => r.menuKind !== "restaurant");
  const splitTotal = rows.reduce((s, r) => s + r.splitOff, 0);
  console.log(`multi-loc clusters: ${rows.length}`);
  console.log(`  chains (all):           ${chains.length}`);
  console.log(`    restaurant chains:    ${restChains.length}`);
  console.log(`    retail (excluded):    ${retailChains.length}`);
  console.log(`  review:                 ${rows.filter((r) => r.klass === "review").length}`);
  console.log(`  not-chain:              ${rows.filter((r) => r.klass === "not-chain").length}`);
  console.log(`  insufficient:           ${rows.filter((r) => r.klass === "insufficient").length}`);
  console.log(`  odd-duck locations split off (generic): ${splitTotal}`);

  const probe = ["chick-fil-a","the-ice-cream-shop","waba-grill","boba-time","subway","zankou-chicken","joe-s-pizza","santouka-ramen","cvs"];
  console.log(`\n=== key landings ===`);
  for (const slug of probe) {
    const r = rows.find((x) => x.slug === slug);
    if (r) console.log(`  ${r.display.padEnd(24)} locs=${String(r.locations).padStart(3)} best=${r.bestPair.toFixed(2)} dist=${r.distinctive ? "Y" : "n"} kind=${r.menuKind.padEnd(20)} -> ${r.klass}${r.splitOff ? ` (split ${r.splitOff})` : ""}`);
  }
  console.log(`\n=== generic clusters with odd-ducks split off ===`);
  for (const r of rows.filter((r) => r.splitOff > 0).sort((a, b) => b.splitOff - a.splitOff).slice(0, 15))
    console.log(`  ${r.display.padEnd(28)} scored=${r.scored} admitted=${r.admitted} split=${r.splitOff}`);

  writeFileSync("scripts/phase0-chains.json", JSON.stringify({ rows }, null, 2));
  console.log(`\nwrote scripts/phase0-chains.json (${rows.length} clusters)`);
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
