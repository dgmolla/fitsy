/**
 * Phase 1 — official-source DISCOVERY spike (the "first half").
 *
 * Measures the official-source hit rate over the gated head brands BEFORE we
 * commit to the extraction half. Per brand:
 *   1. pull a few sample menu items from our DB (the disambiguation/verify key)
 *   2. Brave web search "<brand> nutrition"
 *   3. classify each result: official | aggregator | unrelated
 *      (domain-stem ~= brandSlug, aggregator/ordering/social blocklist)
 *   4. verify the chosen official page actually mentions our menu items
 *      and carries a nutrition signal ("calorie"/"nutrition"/"protein")
 *
 * READ-ONLY: no DB writes, no schema changes. Reports a hit-rate table +
 * writes scripts/phase1-discover-sample.json.
 *
 * Run:  npx tsx --env-file=.env.local scripts/phase1-discover-official.ts [N]
 *       N = number of head brands to probe (default 20).
 *
 * See docs/engineering/pipeline/canonical-chain-macros.md (Phase 1, Step A).
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const p = new PrismaClient();
const N = Number(process.argv[2] ?? 20);
const REGION = "Los Angeles"; // detection corpus is LA; used to disambiguate tail names

// Aggregators + ordering platforms + social — never the official source.
const AGGREGATORS = [
  "fatsecret.com", "myfitnesspal.com", "nutritionix.com", "calorieking.com",
  "eatthismuch.com", "nutritionvalue.org", "menuwithprice.com", "fastfoodnutrition.org",
  "fastfoodnutrition.com", "mynetdiary.com", "verywellfit.com", "healthline.com",
  "allmenus.com", "menuism.com", "caloriecount.com", "secretmenus.com", "menustat.org",
  // ordering / discovery platforms
  "ubereats.com", "doordash.com", "grubhub.com", "postmates.com", "seamless.com",
  "yelp.com", "tripadvisor.com", "zomato.com", "opentable.com", "slicelife.com",
  "toasttab.com", "chownow.com", "menupages.com",
  // social / generic
  "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com",
  "wikipedia.org", "reddit.com", "linkedin.com", "youtube.com", "pinterest.com",
];

type Klass = "official" | "aggregator" | "unrelated";
interface Cand { url: string; title: string; desc: string; domain: string; klass: Klass }
interface BrandResult {
  slug: string;
  display: string;
  locationCount: number;
  sampleItems: string[];
  query: string;
  candidates: Cand[];
  official: string | null;
  artifactType: "pdf" | "nutrition-page" | "site" | null; // extraction modality for Step B
  aggregatorsSeen: string[];
  verified: boolean;          // official page mentions >=2 of our menu items (static-readable)
  nutritionSignal: boolean;   // official page mentions calories/nutrition/protein (static-readable)
  outcome: "official-verified" | "official-nutrition" | "official-artifact" | "official-bare" | "aggregator-only" | "none";
}

// What kind of nutrition artifact is this URL, by path/extension (cheap, fetch-free).
function artifactOf(url: string | undefined): BrandResult["artifactType"] {
  if (!url) return null;
  if (/\.pdf(\?|$)/i.test(url)) return "pdf";
  if (/nutrition|calorie/i.test(url)) return "nutrition-page";
  return "site";
}

// registrable-ish domain: last two labels (good enough; ignores co.uk etc.)
function domainOf(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const parts = h.split(".");
    return parts.length > 2 ? parts.slice(-2).join(".") : h;
  } catch {
    return "";
  }
}
const core = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function classify(url: string, brandSlug: string): Klass {
  const domain = domainOf(url);
  if (!domain) return "unrelated";
  if (AGGREGATORS.some((a) => domain === a || domain.endsWith("." + a))) return "aggregator";
  const brandCore = core(brandSlug); // "mcdonald-s" -> "mcdonalds"
  const domCore = core(domain.split(".")[0]!); // "mcdonalds.com" -> "mcdonalds"
  // official if either core contains the other (guard against tiny tokens)
  if (brandCore.length >= 4 && (domCore.includes(brandCore) || brandCore.includes(domCore)))
    return "official";
  return "unrelated";
}

async function braveSearch(q: string): Promise<Cand[]> {
  const key = process.env["BRAVE_SEARCH_API_KEY"];
  if (!key) throw new Error("BRAVE_SEARCH_API_KEY missing");
  const params = new URLSearchParams({ q, count: "10" });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": key },
  });
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const data = (await res.json()) as { web?: { results?: { url?: string; title?: string; description?: string }[] } };
  return (data.web?.results ?? []).map((r) => ({
    url: r.url ?? "",
    title: r.title ?? "",
    desc: r.description ?? "",
    domain: domainOf(r.url ?? ""),
    klass: "unrelated" as Klass,
  }));
}

// Fetch the official page and verify it mentions our menu items + a nutrition signal.
async function verifyOfficial(url: string, items: string[]): Promise<{ verified: boolean; nutritionSignal: boolean }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
    });
    clearTimeout(t);
    if (!res.ok) return { verified: false, nutritionSignal: false };
    const html = (await res.text()).toLowerCase().replace(/<[^>]+>/g, " ");
    const nutritionSignal = /calorie|nutrition|protein/.test(html);
    // count how many sample items appear (by distinctive token overlap)
    const STOP = new Set(["the", "a", "with", "and", "of", "in", "combo", "meal", "bowl", "plate"]);
    let hits = 0;
    for (const it of items) {
      const toks = it.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
      if (toks.length && toks.every((w) => html.includes(w))) hits++;
    }
    return { verified: hits >= 2, nutritionSignal };
  } catch {
    return { verified: false, nutritionSignal: false };
  }
}

async function sampleItemsFor(brandId: string): Promise<string[]> {
  // most-common item names across this brand's locations = its menu core
  const rows = await p.menuItem.findMany({
    where: { restaurant: { brandId } },
    select: { name: true },
    take: 2000,
  });
  const freq = new Map<string, number>();
  for (const r of rows) freq.set(r.name, (freq.get(r.name) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n);
}

async function main() {
  // gated head: restaurant menuKind, >=3 locations, no official source yet
  const brands = await p.brand.findMany({
    where: { menuKind: "restaurant", locationCount: { gte: 3 } },
    orderBy: { locationCount: "desc" },
    take: N,
    select: { id: true, slug: true, displayName: true, locationCount: true },
  });

  const results: BrandResult[] = [];
  for (const b of brands) {
    const items = await sampleItemsFor(b.id);
    const query = `${b.displayName} nutrition`;
    let cands: Cand[] = [];
    try {
      cands = await braveSearch(query);
    } catch (e) {
      console.error(`  brave failed for ${b.slug}:`, (e as Error).message);
    }
    for (const c of cands) c.klass = classify(c.url, b.slug);

    const aggregatorsSeen = [...new Set(cands.filter((c) => c.klass === "aggregator").map((c) => c.domain))];
    // rank official candidates: prefer US/.com + nutrition-looking URLs over foreign TLDs.
    const FOREIGN = /\.(ca|ie|co\.uk|gb|au|mx|de|fr|es|it|nl|in|jp|sg)$/;
    const officialCand = cands
      .filter((c) => c.klass === "official")
      .map((c) => {
        let s = 0;
        if (/nutrition|calorie/i.test(c.url)) s += 4;
        if (/[/-]en-us|\/us\//i.test(c.url)) s += 2;
        if (c.domain.endsWith(".com")) s += 2;
        if (FOREIGN.test(c.domain)) s -= 5;
        return { c, s };
      })
      .sort((a, b) => b.s - a.s)[0]?.c;
    let chosen = officialCand;
    let usedFallbackQuery = false;
    let verified = false, nutritionSignal = false;
    if (chosen) {
      let v = await verifyOfficial(chosen.url, items);
      // fallback: domain found but this URL isn't a nutrition page -> site-scoped re-query
      if (!v.verified && !v.nutritionSignal && !/nutrition|calorie/i.test(chosen.url)) {
        usedFallbackQuery = true;
        try {
          const fb = await braveSearch(`site:${chosen.domain} nutrition menu`);
          const np = fb.find((c) => /nutrition|calorie/i.test(c.url) && domainOf(c.url) === chosen!.domain);
          if (np) { chosen = { ...np, klass: "official" }; v = await verifyOfficial(np.url, items); }
        } catch { /* keep original */ }
      }
      verified = v.verified; nutritionSignal = v.nutritionSignal;
    }
    const officialFinal = chosen;
    const artifactType = artifactOf(officialFinal?.url);
    const isArtifact = artifactType === "pdf" || artifactType === "nutrition-page";
    const outcome: BrandResult["outcome"] = officialFinal
      ? verified ? "official-verified"
      : nutritionSignal ? "official-nutrition"
      : isArtifact ? "official-artifact"   // nutrition page/PDF found, but static fetch couldn't read it (SPA/PDF)
      : "official-bare"
      : aggregatorsSeen.length ? "aggregator-only" : "none";

    results.push({
      slug: b.slug, display: b.displayName, locationCount: b.locationCount,
      sampleItems: items, query, candidates: cands,
      official: officialFinal?.url ?? null, artifactType, aggregatorsSeen, verified, nutritionSignal, outcome,
    });
    const tag = { "official-verified": "✓ verified", "official-nutrition": "✓ nutri-page", "official-artifact": `✓ ${artifactType === "pdf" ? "PDF" : "spa-page"}`, "official-bare": "~ official", "aggregator-only": "agg-only", none: "✗ none" }[outcome];
    console.log(`${b.locationCount.toString().padStart(4)}  ${b.displayName.slice(0, 28).padEnd(28)}  ${tag.padEnd(11)}  ${usedFallbackQuery ? "↻ " : "  "}${officialFinal?.domain ?? aggregatorsSeen[0] ?? "—"}`);
  }

  // summary
  const by = (o: string) => results.filter((r) => r.outcome === o).length;
  const officialAny = by("official-verified") + by("official-nutrition") + by("official-artifact") + by("official-bare");
  const artifact = by("official-verified") + by("official-nutrition") + by("official-artifact");
  const pdfs = results.filter((r) => r.outcome === "official-artifact" && r.artifactType === "pdf").length;
  const pages = results.filter((r) => r.outcome === "official-artifact" && r.artifactType === "nutrition-page").length;
  console.log("\n=== hit rate over", results.length, "head brands ===");
  console.log(`  official domain found   : ${officialAny}/${results.length} (${Math.round((100 * officialAny) / results.length)}%)`);
  console.log(`    └ on a nutrition artifact: ${artifact}/${results.length} (${Math.round((100 * artifact) / results.length)}%)   <- Step B extraction targets`);
  console.log(`        ├ static-readable now : ${by("official-verified") + by("official-nutrition")} (plain HTML)`);
  console.log(`        └ needs render/parse  : ${by("official-artifact")}  (PDF×${pdfs}, JS-SPA×${pages})  <- vision/headless`);
  console.log(`    └ domain only, no artifact: ${by("official-bare")}`);
  console.log(`  aggregator-only           : ${by("aggregator-only")}`);
  console.log(`  nothing usable            : ${by("none")}`);

  writeFileSync("scripts/phase1-discover-sample.json", JSON.stringify({ generatedFor: `top ${N} head brands`, region: REGION, results }, null, 2));
  console.log("\nwrote scripts/phase1-discover-sample.json");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
