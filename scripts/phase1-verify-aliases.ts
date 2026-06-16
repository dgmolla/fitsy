/**
 * Phase 1 — verified, confidence-gated resolver. Filters the candidate aliases (aliases.json)
 * down to high-precision matches so Phase 2/3 backfill is safe.
 *
 *   1. Deterministic combo/size guard: reject UE↔official pairs where one is a combo/meal/box
 *      (or a size/variant token) the other isn't — the systematic failure modes.
 *   2. Adversarial verify: a strict skeptic LLM (default REJECT unless clearly the same item AND
 *      same nutrition), shown both calorie values to catch combos/size mismatches.
 *
 * Writes aliases-verified.json (same shape as aliases.json, filtered). Re-measure precision with
 * phase1-precision.ts pointed at it.
 *
 *   npx tsx --env-file=.env.local scripts/phase1-verify-aliases.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";

const MODEL = "claude-haiku-4-5" as const;
const p = new PrismaClient();
const anthropic = new Anthropic();
const slug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// systematic failure modes: combo/meal markers and size/variant tokens
const COMBO = /\b(combo|meal|box|family|party|bundle|feast|platter|catering|group|pack)\b/i;
const SIZES = ["small", "medium", "large", "regular", "kids", "mini", "jumbo", "personal", "xl"];
function comboGuard(ue: string, off: string): boolean {
  if (COMBO.test(ue) !== COMBO.test(off)) return false; // one is a combo, other isn't → reject
  const us = SIZES.filter((z) => new RegExp(`\\b${z}\\b`, "i").test(ue));
  const os = SIZES.filter((z) => new RegExp(`\\b${z}\\b`, "i").test(off));
  if (us.length && os.length && !us.some((z) => os.includes(z))) return false; // explicit, different sizes → reject
  return true;
}

const VERIFY = {
  name: "verify", description: "Strictly verify each pair is the same menu item with the same nutrition.",
  input_schema: { type: "object" as const, properties: { results: { type: "array", items: { type: "object", properties: {
    i: { type: "number" }, keep: { type: "boolean", description: "true ONLY if same item AND same nutrition; reject combos vs base, size/variant/base differences, or if uncertain" },
  }, required: ["i", "keep"] } } }, required: ["results"] },
};

async function main() {
  const aliases: Record<string, Record<string, string[]>> = JSON.parse(readFileSync("scripts/phase1-out/aliases.json", "utf8"));
  const ci = JSON.parse(readFileSync("scripts/phase1-out/chainitems.json", "utf8")).items as any[];
  const offInfo = new Map<string, { name: string; cal: number | null }>();
  for (const it of ci) { const k = it.brandSlug + "|" + it.canonicalKey; if (!offInfo.has(k)) offInfo.set(k, { name: it.name, cal: it.calories }); }

  const brands = await p.brand.findMany({ where: { slug: { in: Object.keys(aliases) } }, select: { id: true, slug: true, displayName: true } });
  // candidate pairs with names + calories
  type Cand = { brand: string; brandSlug: string; key: string; ueSlug: string; ue: string; off: string; offCal: number | null; estCal: number | null };
  const cands: Cand[] = [];
  for (const b of brands) {
    const keyByAlias = new Map<string, string>();
    for (const [k, al] of Object.entries(aliases[b.slug] ?? {})) for (const a of al) keyByAlias.set(a, k);
    const items = await p.menuItem.findMany({ where: { restaurant: { brandId: b.id } }, select: { name: true, calories: true } });
    const seen = new Set<string>();
    for (const it of items) { const s = slug(it.name); if (seen.has(s)) continue; seen.add(s);
      const k = keyByAlias.get(s); if (!k) continue; const oi = offInfo.get(b.slug + "|" + k); if (!oi) continue;
      if (slug(oi.name) === s) { continue; } // exact name = trivially kept (handled below)
      cands.push({ brand: b.displayName, brandSlug: b.slug, key: k, ueSlug: s, ue: it.name, off: oi.name, offCal: oi.cal, estCal: it.calories });
    }
  }

  // step 1: deterministic guard
  const guarded = cands.filter((c) => comboGuard(c.ue, c.off));
  const droppedGuard = cands.length - guarded.length;

  // step 2: adversarial verify (chunked)
  const kept = new Set<number>();
  for (let i = 0; i < guarded.length; i += 50) {
    const chunk = guarded.slice(i, i + 50);
    const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 4000, tools: [VERIFY], tool_choice: { type: "tool", name: VERIFY.name },
      messages: [{ role: "user", content:
        `You are a STRICT reviewer guarding a nutrition database. For each pair decide keep=true ONLY if the Uber Eats item ` +
        `is the SAME menu item as the official item AND would have essentially the same nutrition. REJECT if: one is a combo/meal ` +
        `and the other isn't; sizes differ; one has extra components (club, deluxe, loaded); different base (smoothie vs tea, ` +
        `deep-dish vs thin); or you are unsure. Calorie values are given — a large gap usually means different items.\n\n` +
        chunk.map((c, j) => `${j}. [${c.brand}] UE="${c.ue}" (${c.estCal ?? "?"} cal)  OFFICIAL="${c.off}" (${c.offCal ?? "?"} cal)`).join("\n") }] });
    const rs = (msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")?.input as any)?.results ?? [];
    for (const r of rs) if (r.keep && guarded[i + r.i]) kept.add(i + r.i);
  }

  // rebuild verified aliases: exact-slug matches always kept; non-exact kept only if verified
  const verified: Record<string, Record<string, string[]>> = {};
  // exact matches (ueSlug === slug(officialName)) were excluded from cands; re-add them from aliases where alias===slug(name)
  for (const b of brands) {
    const out: Record<string, Set<string>> = {};
    for (const [k, al] of Object.entries(aliases[b.slug] ?? {})) {
      const oi = offInfo.get(b.slug + "|" + k); const offSlug = oi ? slug(oi.name) : "";
      for (const a of al) if (a === offSlug) (out[k] ??= new Set()).add(a); // exact name match → trust
    }
    if (Object.keys(out).length) verified[b.slug] = Object.fromEntries(Object.entries(out).map(([k, s]) => [k, [...s]]));
  }
  guarded.forEach((c, idx) => { if (kept.has(idx)) { (verified[c.brandSlug] ??= {}); (verified[c.brandSlug]![c.key] ??= []); if (!verified[c.brandSlug]![c.key]!.includes(c.ueSlug)) verified[c.brandSlug]![c.key]!.push(c.ueSlug); } });

  writeFileSync("scripts/phase1-out/aliases-verified.json", JSON.stringify(verified, null, 2));
  const candN = cands.length, keptN = kept.size, exact = Object.values(verified).reduce((a, b) => a + Object.values(b).reduce((x, y) => x + y.length, 0), 0) - keptN;
  console.log(`=== alias verification ===`);
  console.log(`  non-exact candidate matches : ${candN}`);
  console.log(`    dropped by combo/size guard: ${droppedGuard}`);
  console.log(`    sent to skeptic            : ${guarded.length}  → kept ${keptN}, rejected ${guarded.length - keptN}`);
  console.log(`  exact-name matches (trusted) : ${exact}`);
  console.log(`  → aliases-verified.json: ${exact + keptN} total alias slugs (was ${candN + exact} candidate)`);
  console.log(`  re-measure: npx tsx --env-file=.env.local scripts/phase1-precision.ts 150 aliases-verified.json`);
}
main().catch((e) => { console.error("VERIFY ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
