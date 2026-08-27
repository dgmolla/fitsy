/**
 * Phase 0.5 — risk-gated LLM tiebreaker (read-only).
 * Reads scripts/phase0-chains.json, selects the risky/ambiguous residual, and asks
 * Haiku to adjudicate same-brand / restaurant-chain / retail per cluster.
 * READ-ONLY: no DB writes. Writes scripts/phase0-tiebreak.json with verdicts.
 */
import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";

const p = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"]! });
const MODEL = "claude-haiku-4-5" as const;
const MAX_CALLS = 150;
const CONCURRENCY = 6;
const SAMPLE_LOCS = 3;
const SAMPLE_ITEMS = 18;

function normalizeBrand(raw: string): string {
  const GAZ = new Set(["los-angeles","la","hollywood","glendale","pasadena","burbank","santa-monica","long-beach","downtown","dtla","koreatown","ktown","echo-park","silver-lake","venice","culver-city","west-la","sherman-oaks","van-nuys","north-hollywood","noho","west-hollywood","weho","beverly-hills","torrance","redondo-beach","el-segundo","inglewood","westwood","brentwood"]);
  let s = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[®™©]/g, " ");
  s = s.replace(/\(.*?\)/g, " ").replace(/#\s*\d+/g, " ").replace(/\bno\.?\s*\d+\b/g, " ");
  s = s.split(/\s[-–]\s|\s@\s|\bat\b/)[0]!.replace(/\b(llc|inc|co|corp|ltd)\b/g, " ");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  let parts = s.split("-");
  while (parts.length > 1 && GAZ.has(parts[parts.length - 1]!)) parts.pop();
  return parts.join("-");
}
// place names that read as "brand words" but are really locations (collision risk)
const PLACE = new Set(["tokyo","la","california","cali","hollywood","venice","koreatown","pasadena","glendale","vegas","york","texas","chicago","boston","tehran","osaka","seoul","beijing","shanghai","mexico","cuba","havana","brooklyn","manhattan","malibu"]);

function gated(r: any): { sel: boolean; why: string } {
  if (r.klass === "review") return { sel: true, why: "review" };
  if (r.splitOff > 0) return { sel: true, why: "odd-duck" };
  if (r.klass === "chain" && !r.distinctive && r.menuKind === "restaurant") return { sel: true, why: "generic-admit" };
  if (r.klass === "chain" && r.locations <= 3 && r.bestPair < 0.7) return { sel: true, why: "small-low-overlap" };
  if (r.klass === "chain" && r.distinctive) {
    const toks = r.slug.split("-").filter((t: string) => t);
    if (toks.some((t: string) => PLACE.has(t))) return { sel: true, why: "place-name" };
  }
  return { sel: false, why: "" };
}

const VERDICT = `Return ONLY a JSON object (no markdown, no prose) with these fields:
{"same_brand": boolean,            // are these locations all the same real business/brand?
 "is_restaurant_chain": boolean,   // a restaurant chain (not a single indie, unrelated places, or non-restaurant)?
 "is_retail": boolean,             // grocery / convenience / drugstore / liquor / pet store, not a restaurant?
 "retail_kind": "grocery"|"convenience"|"pharmacy"|"liquor"|"pet"|null,
 "canonical_name": string,         // the canonical brand name
 "confidence": "high"|"medium"|"low",
 "reason": string}                 // one short sentence`;

async function adjudicate(name: string, locations: number, menus: string[][]): Promise<any> {
  const body = menus.map((m, i) => `Location ${i + 1} menu sample:\n- ${m.join("\n- ")}`).join("\n\n");
  const prompt = `You are doing entity resolution for a restaurant-discovery database. ${locations} locations share the normalized name "${name}". Using world knowledge AND the menu samples, decide if they are the same real restaurant brand/chain.\n\n${body}\n\n${VERDICT}`;
  const res = await anthropic.messages.create({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content: prompt }] });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const json = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(json);
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

async function main() {
  const data = JSON.parse(readFileSync("scripts/phase0-chains.json", "utf8")) as { rows: any[] };
  const selected = data.rows.map((r) => ({ r, g: gated(r) })).filter((x) => x.g.sel).map((x) => ({ ...x.r, why: x.g.why }));
  console.log(`gated for tiebreak: ${selected.length} (cap ${MAX_CALLS})`);
  const byWhy: Record<string, number> = {};
  for (const s of selected) byWhy[s.why] = (byWhy[s.why] ?? 0) + 1;
  console.log("by gate reason:", JSON.stringify(byWhy));
  const work = selected.slice(0, MAX_CALLS);

  // slug -> restaurant ids
  const rests = await p.restaurant.findMany({ select: { id: true, name: true } });
  const idsBySlug = new Map<string, string[]>();
  for (const r of rests) { const s = normalizeBrand(r.name); if (!idsBySlug.has(s)) idsBySlug.set(s, []); idsBySlug.get(s)!.push(r.id); }

  let ok = 0, err = 0;
  const results = await pool(work, CONCURRENCY, async (row) => {
    const ids = (idsBySlug.get(row.slug) ?? []).slice(0, SAMPLE_LOCS);
    const menus: string[][] = [];
    for (const id of ids) {
      const items = await p.menuItem.findMany({ where: { restaurantId: id }, select: { name: true }, take: SAMPLE_ITEMS });
      menus.push(items.map((i) => i.name));
    }
    try {
      const v = await adjudicate(row.display, row.locations, menus);
      ok++;
      return { slug: row.slug, display: row.display, why: row.why, algo: row.klass, algoKind: row.menuKind, distinctive: row.distinctive, bestPair: row.bestPair, llm: v };
    } catch (e) {
      err++;
      return { slug: row.slug, display: row.display, why: row.why, algo: row.klass, error: String(e).slice(0, 80) };
    }
  });

  console.log(`\ndone: ${ok} ok, ${err} errors\n`);
  const good = results.filter((r) => r.llm);
  // agreement analysis
  const reviewRows = good.filter((r) => r.algo === "review");
  const reviewChain = reviewRows.filter((r) => r.llm.is_restaurant_chain && !r.llm.is_retail);
  const reviewRetail = reviewRows.filter((r) => r.llm.is_retail);
  const reviewNot = reviewRows.filter((r) => !r.llm.is_restaurant_chain && !r.llm.is_retail);
  const genAdmit = good.filter((r) => r.why === "generic-admit");
  const genConfirmed = genAdmit.filter((r) => r.llm.same_brand && r.llm.is_restaurant_chain);
  const genRejected = genAdmit.filter((r) => !(r.llm.same_brand && r.llm.is_restaurant_chain));
  const retailFound = good.filter((r) => r.llm.is_retail && r.algoKind === "restaurant");

  console.log(`REVIEW band (${reviewRows.length}): LLM says restaurant-chain=${reviewChain.length}, retail=${reviewRetail.length}, not-a-chain=${reviewNot.length}`);
  console.log(`GENERIC admits (${genAdmit.length}): confirmed=${genConfirmed.length}, rejected/uncertain=${genRejected.length}`);
  console.log(`RETAIL the algo missed (algo=restaurant, LLM=retail): ${retailFound.length}`);

  console.log(`\n-- review → promote to chain (sample) --`);
  for (const r of reviewChain.slice(0, 12)) console.log(`  ${r.display.padEnd(26)} "${r.llm.canonical_name}" conf=${r.llm.confidence}`);
  console.log(`\n-- review → reject (not a chain) --`);
  for (const r of reviewNot.slice(0, 12)) console.log(`  ${r.display.padEnd(26)} ${r.llm.reason}`);
  console.log(`\n-- generic admits the LLM REJECTS (likely false merges) --`);
  for (const r of genRejected.slice(0, 12)) console.log(`  ${r.display.padEnd(26)} ${r.llm.reason}`);
  console.log(`\n-- retail the algo missed --`);
  for (const r of retailFound.slice(0, 12)) console.log(`  ${r.display.padEnd(26)} ${r.llm.retail_kind}: ${r.llm.reason}`);

  writeFileSync("scripts/phase0-tiebreak.json", JSON.stringify({ results }, null, 2));
  console.log(`\nwrote scripts/phase0-tiebreak.json (${results.length})`);
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
