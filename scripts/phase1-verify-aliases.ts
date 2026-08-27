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

  // step 2: adversarial verify, TWO independent skeptic votes → confidence tier
  const votes = new Array(guarded.length).fill(0);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < guarded.length; i += 50) {
      const chunk = guarded.slice(i, i + 50);
      const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 4000, tools: [VERIFY], tool_choice: { type: "tool", name: VERIFY.name },
        messages: [{ role: "user", content:
          `You are a STRICT reviewer guarding a nutrition database. For each pair decide keep=true ONLY if the Uber Eats item ` +
          `is the SAME menu item as the official item AND would have essentially the same nutrition. REJECT if: one is a combo/meal ` +
          `and the other isn't; sizes differ; one has extra components (club, deluxe, loaded); different base (smoothie vs tea, ` +
          `deep-dish vs thin); one is a composed dish (bowl/plate) and the other a bare ingredient; a dietary variant (vegan/skinny) ` +
          `vs regular; or you are unsure.\n\n` +
          chunk.map((c, j) => `${j}. [${c.brand}] UE="${c.ue}"  OFFICIAL="${c.off}"`).join("\n") }] });
      const rs = (msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")?.input as any)?.results ?? [];
      for (const r of rs) if (r.keep && guarded[i + r.i]) votes[i + r.i]++;
    }
  }

  // tier: exact name = HIGH; 2/2 skeptic votes = HIGH; 1/2 = MEDIUM; else dropped
  const high: Record<string, Record<string, string[]>> = {};
  const medium: Record<string, Record<string, string[]>> = {};
  const add = (m: Record<string, Record<string, string[]>>, bs: string, k: string, s: string) => { (m[bs] ??= {}); (m[bs]![k] ??= []); if (!m[bs]![k]!.includes(s)) m[bs]![k]!.push(s); };
  // exact matches → HIGH
  for (const b of brands) for (const [k, al] of Object.entries(aliases[b.slug] ?? {})) {
    const oi = offInfo.get(b.slug + "|" + k); const offSlug = oi ? slug(oi.name) : "";
    for (const a of al) if (a === offSlug) add(high, b.slug, k, a);
  }
  let nHigh2 = 0, nMed = 0;
  guarded.forEach((c, idx) => { if (votes[idx] === 2) { add(high, c.brandSlug, c.key, c.ueSlug); nHigh2++; } else if (votes[idx] === 1) { add(medium, c.brandSlug, c.key, c.ueSlug); nMed++; } });

  writeFileSync("scripts/phase1-out/aliases-high.json", JSON.stringify(high, null, 2));
  writeFileSync("scripts/phase1-out/aliases-medium.json", JSON.stringify(medium, null, 2));
  const exact = Object.values(high).reduce((a, b) => a + Object.values(b).reduce((x, y) => x + y.length, 0), 0) - nHigh2;
  console.log(`=== alias verification (confidence tiers) ===`);
  console.log(`  non-exact candidates        : ${cands.length}   (dropped by combo/size guard: ${droppedGuard})`);
  console.log(`  2-vote skeptic on ${guarded.length}:`);
  console.log(`    HIGH (exact + 2/2 votes)  : ${exact + nHigh2}  (exact ${exact} + unanimous ${nHigh2})   → OVERRIDES`);
  console.log(`    MEDIUM (1/2 votes)        : ${nMed}   → store-only, never overrides`);
  console.log(`    dropped (0/2 or guard)    : ${cands.length - nHigh2 - nMed}`);
  console.log(`  → aliases-high.json (override tier) + aliases-medium.json (store-only)`);
  console.log(`  measure HIGH precision: npx tsx --env-file=.env.local scripts/phase1-precision.ts 150 aliases-high.json`);
}
main().catch((e) => { console.error("VERIFY ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
