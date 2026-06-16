/**
 * Phase 1 — alignment PRECISION measurement (safety gate for Phase 2/3 backfill).
 *
 * Match rate said HOW MANY UE items resolve to canon (41%). This measures HOW MANY of those
 * matches are CORRECT — an independent LLM judge (not the aligner) decides whether each matched
 * (UE item ↔ official item) pair is genuinely the same food. Backfilling official macros onto
 * user-facing items is only safe if precision is high (a wrong alias = confidently-wrong nutrition).
 *
 *   npx tsx --env-file=.env.local scripts/phase1-precision.ts [sampleSize]
 */
import Anthropic from "@anthropic-ai/sdk";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const MODEL = "claude-haiku-4-5" as const;
const p = new PrismaClient();
const anthropic = new Anthropic();
const SAMPLE = Number(process.argv[2] ?? 150);
const ALIAS_FILE = "scripts/phase1-out/" + (process.argv[3] ?? "aliases.json");
const slug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const JUDGE = {
  name: "judge", description: "Judge whether each Uber Eats item is the SAME menu item as the matched official item.",
  input_schema: { type: "object" as const, properties: { verdicts: { type: "array", items: { type: "object", properties: {
    i: { type: "number" }, same: { type: "boolean", description: "true if same food/drink (size/wording differences ok), false if different items" },
  }, required: ["i", "same"] } } }, required: ["verdicts"] },
};

async function main() {
  const aliases: Record<string, Record<string, string[]>> = JSON.parse(readFileSync(ALIAS_FILE, "utf8"));
  console.log(`(measuring ${ALIAS_FILE})`);
  const ci = JSON.parse(readFileSync("scripts/phase1-out/chainitems.json", "utf8")).items as any[];
  const officialName = new Map<string, string>(); // brandSlug|key -> official name
  for (const it of ci) if (!officialName.has(it.brandSlug + "|" + it.canonicalKey)) officialName.set(it.brandSlug + "|" + it.canonicalKey, it.name);

  // build matched pairs (ueName, officialName) by reverse-looking-up aliases against real UE names
  const brands = await p.brand.findMany({ where: { slug: { in: Object.keys(aliases) } }, select: { id: true, slug: true, displayName: true } });
  const pairs: { brand: string; ue: string; off: string }[] = [];
  for (const b of brands) {
    const keyByAlias = new Map<string, string>();
    for (const [k, al] of Object.entries(aliases[b.slug] ?? {})) for (const a of al) keyByAlias.set(a, k);
    const items = await p.menuItem.findMany({ where: { restaurant: { brandId: b.id } }, select: { name: true }, take: 5000 });
    const seen = new Set<string>();
    for (const it of items) {
      const s = slug(it.name); if (seen.has(s)) continue; seen.add(s);
      const k = keyByAlias.get(s);
      if (k && !aliases[b.slug]![k]!.includes(s)) continue; // sanity
      if (k) { const off = officialName.get(b.slug + "|" + k); if (off && slug(off) !== s) pairs.push({ brand: b.displayName, ue: it.name, off }); }
    }
  }
  // even spread: shuffle deterministically by index stride, take SAMPLE
  const stride = Math.max(1, Math.floor(pairs.length / SAMPLE));
  const sample = pairs.filter((_, i) => i % stride === 0).slice(0, SAMPLE);
  console.log(`matched pairs total: ${pairs.length}; judging a spread of ${sample.length}\n`);

  let same = 0, diff = 0;
  const wrong: { brand: string; ue: string; off: string }[] = [];
  for (let i = 0; i < sample.length; i += 50) {
    const chunk = sample.slice(i, i + 50);
    const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 4000, tools: [JUDGE], tool_choice: { type: "tool", name: JUDGE.name },
      messages: [{ role: "user", content:
        `For each pair, is the Uber Eats item the SAME menu item as the official item (same food/drink; ignore size, wording, "sub"/"sandwich", packaging)? Call judge.\n\n` +
        chunk.map((c, j) => `${j}. [${c.brand}] UE="${c.ue}"  OFFICIAL="${c.off}"`).join("\n") }] });
    const v = (msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")?.input as any)?.verdicts ?? [];
    for (const ver of v) { const pr = chunk[ver.i]; if (!pr) continue; if (ver.same) same++; else { diff++; if (wrong.length < 12) wrong.push(pr); } }
  }
  const judged = same + diff;
  console.log(`=== ALIGNMENT PRECISION ===`);
  console.log(`  judged pairs : ${judged}`);
  console.log(`  same (correct): ${same}  (${Math.round(100 * same / judged)}%)  ← precision`);
  console.log(`  different (WRONG match): ${diff}  (${Math.round(100 * diff / judged)}%)`);
  console.log(`\n  sample WRONG matches (these would write bad macros in a blind backfill):`);
  for (const w of wrong) console.log(`   [${w.brand}] "${w.ue}"  →  "${w.off}"`);
  console.log(`\n  → Phase 2/3 safe only if precision is high; gate backfill on confidence + provenance + this number.`);
}
main().catch((e) => { console.error("PRECISION ERROR:", e.message); process.exit(1); }).finally(() => p.$disconnect());
