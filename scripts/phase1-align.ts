/**
 * Phase 1 — POC: LLM alias alignment (the resolver that makes the canon-first pipeline fire).
 *
 * For each brand: hand Haiku the brand's official canonical items (key + name) and its actual
 * Uber-Eats menu-item names, and ask it to map each UE name → the matching canonicalKey. The
 * resulting UE-name → canonicalKey pairs ARE the ChainItem.aliases[] the runtime pipeline matches
 * against (canonicalKey ∪ aliases). Re-measures the match rate naive-slug vs LLM-aligned.
 *
 * This is the forward-wiring resolver: once aliases are populated, prod does a cheap slug lookup
 * of each incoming UE item against canonicalKey∪aliases — no per-item LLM at runtime.
 *
 *   npx tsx --env-file=.env.local scripts/phase1-align.ts [slug1 slug2 ...]   (default: a sample)
 */
import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const MODEL = "claude-haiku-4-5" as const;
const p = new PrismaClient();
const anthropic = new Anthropic();
const slug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const TOOL = {
  name: "map_items",
  description: "Map each Uber Eats menu item name to the canonical key of the SAME menu item from the official list (same food/drink; ignore size, format, and wording differences). Use empty string if no official item matches.",
  input_schema: {
    type: "object" as const,
    properties: { mappings: { type: "array", items: { type: "object", properties: {
      ue_name: { type: "string" }, canonical_key: { type: "string", description: "a key from the official list, or empty" },
    }, required: ["ue_name", "canonical_key"] } } }, required: ["mappings"],
  },
};

async function alignBrand(displayName: string, official: { canonicalKey: string; name: string }[], ueNames: string[]) {
  const officialList = official.map((o) => `${o.canonicalKey} :: ${o.name}`).join("\n");
  const out = new Map<string, string>(); // ueName -> canonicalKey
  const validKeys = new Set(official.map((o) => o.canonicalKey));
  for (let i = 0; i < ueNames.length; i += 80) {
    const chunk = ueNames.slice(i, i + 80);
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 8000, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content:
        `Brand: ${displayName}\n\nOFFICIAL canonical items (key :: name):\n${officialList}\n\n` +
        `UBER EATS item names to map:\n${chunk.map((n, j) => `${j + 1}. ${n}`).join("\n")}\n\n` +
        `Call map_items: for each UE name, give the canonical_key of the official item that is the SAME food/drink ` +
        `(ignore size/regular/large, "sub"/"sandwich", packaging, and word order). Empty string if none matches.` }],
    });
    const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const maps = (tu?.input as any)?.mappings;
    if (Array.isArray(maps)) for (const m of maps) if (m.canonical_key && validKeys.has(m.canonical_key)) out.set(m.ue_name, m.canonical_key);
  }
  return out;
}

async function main() {
  const ci = JSON.parse(readFileSync("scripts/phase1-out/chainitems.json", "utf8")).items as any[];
  const officialByBrand = new Map<string, { canonicalKey: string; name: string }[]>();
  for (const it of ci) { if (!officialByBrand.has(it.brandSlug)) officialByBrand.set(it.brandSlug, []); officialByBrand.get(it.brandSlug)!.push({ canonicalKey: it.canonicalKey, name: it.name }); }

  const argSlugs = process.argv.slice(2).filter((a) => a !== "--all");
  const slugs = argSlugs.length ? argSlugs : [...officialByBrand.keys()]; // default: ALL 52 official brands
  const brands = await p.brand.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, displayName: true } });

  console.log(`aligning ${brands.length} brands...\n`);
  console.log("brand                     UE-items  naive%  ALIGNED%  (Δ)");
  let tUE = 0, tNaive = 0, tAligned = 0;
  const aliasesOut: Record<string, Record<string, string[]>> = {}; // brandSlug -> canonicalKey -> [alias slugs]
  for (const b of brands) {
    const official = officialByBrand.get(b.slug); if (!official) continue;
    const keys = new Set(official.map((o) => o.canonicalKey));
    const items = await p.menuItem.findMany({ where: { restaurant: { brandId: b.id } }, select: { name: true }, take: 5000 });
    const ueNames = [...new Set(items.map((i) => i.name))].filter(Boolean);
    if (!ueNames.length) continue;
    const naive = ueNames.filter((n) => keys.has(slug(n))).length;
    let aligned = new Map<string, string>();
    try { aligned = await alignBrand(b.displayName, official, ueNames); } catch (e) { console.log(`  ${b.displayName}: align failed (${(e as Error).message.slice(0, 30)})`); }
    const matched = ueNames.filter((n) => keys.has(slug(n)) || aligned.has(n)).length;
    // build aliases: canonicalKey -> set of UE-name slugs (incl. exact slug matches)
    const byKey: Record<string, Set<string>> = {};
    for (const n of ueNames) { const k = keys.has(slug(n)) ? slug(n) : aligned.get(n); if (k) (byKey[k] ??= new Set()).add(slug(n)); }
    aliasesOut[b.slug] = Object.fromEntries(Object.entries(byKey).map(([k, s]) => [k, [...s]]));
    tUE += ueNames.length; tNaive += naive; tAligned += matched;
    const pct = (x: number) => Math.round((100 * x) / ueNames.length);
    console.log(`  ${b.displayName.slice(0, 24).padEnd(24)} ${String(ueNames.length).padStart(5)}   ${String(pct(naive)).padStart(3)}%    ${String(pct(matched)).padStart(3)}%   +${pct(matched) - pct(naive)}`);
  }
  writeFileSync("scripts/phase1-out/aliases.json", JSON.stringify(aliasesOut, null, 2));
  console.log(`\n  OVERALL: naive ${Math.round(100 * tNaive / tUE)}% → aligned ${Math.round(100 * tAligned / tUE)}%  (${tAligned}/${tUE} UE items resolve to canon)`);
  console.log(`  → wrote scripts/phase1-out/aliases.json (canonicalKey → UE-name-slug aliases) for ChainItem.aliases[] / runtime canon-first lookup.`);
}
main().catch((e) => { console.error("ALIGN ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
