/**
 * Phase 1 — extraction back-end (Step B) + PDF→vision route.
 *
 * Shared back-end (route-agnostic):
 *   - cost tracker with a hard cap (guardrail)
 *   - extractFromImages(): forced-tool structured output over page images (SDK v0.36 safe)
 *   - validateRow(): the 4·P+4·C+9·F deterministic check + plausibility bounds
 *   - reconcileKey(): conservative canonicalKey stub
 *   - writeChainItems(): local artifact only (DB landing is gated, M6)
 *
 * PDF route: pdftoppm render → PNG (downscaled via sharp) → extractFromImages.
 *
 * Runbook + guardrails: docs/engineering/pipeline/phase1-extraction-execution.md
 * Model is a single constant (Haiku to start; swap if dense grids fail).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/phase1-extract.ts --selftest
 *   npx tsx --env-file=.env.local scripts/phase1-extract.ts <pdf-path> "<Brand Name>"
 */
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

// ---- config / guardrails ----
const MODEL = "claude-haiku-4-5" as const; // single swap point
const PRICE = { in: 1 / 1_000_000, out: 5 / 1_000_000 }; // Haiku 4.5 $/token
const COST_CAP_USD = 15;
const MAX_PAGES = 40;
const RENDER_DPI = 150;
const MAX_LONG_EDGE = 2200; // keep dense nutrition grids legible; still bounds image tokens (~5k/page)
const MAX_OUT_TOKENS = 16000; // dense single-page brochures emit many rows
const OUT_DIR = "scripts/phase1-out";

// ---- cost tracker ----
export const cost = { usd: 0, calls: 0, inTok: 0, outTok: 0 };
function track(inTok: number, outTok: number) {
  cost.calls++; cost.inTok += inTok; cost.outTok += outTok;
  cost.usd += inTok * PRICE.in + outTok * PRICE.out;
  if (cost.usd > COST_CAP_USD) {
    throw new Error(`COST CAP $${COST_CAP_USD} exceeded (spent $${cost.usd.toFixed(2)}) — STOP & escalate (RED)`);
  }
}

// ---- types ----
export interface NutritionRow {
  name: string;
  servingSize: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}
export interface ChainItemRow extends NutritionRow {
  canonicalKey: string;
  valid: boolean;
  validationNote: string;
}

// ---- validator: the 4/4/9 deterministic gate + plausibility ----
export function validateRow(r: NutritionRow): { valid: boolean; note: string } {
  const { calories: cal, proteinG: p, carbsG: c, fatG: f } = r;
  if (cal == null || p == null || c == null || f == null) return { valid: false, note: "missing-macro" };
  if (cal < 0 || cal > 3000) return { valid: false, note: "cal-out-of-range" };
  if ([p, c, f].some((g) => g < 0 || g > 400)) return { valid: false, note: "gram-out-of-range" };
  const atwater = 4 * p + 4 * c + 9 * f;
  // tolerance: labels round + fiber/alcohol/sugar-alcohol slack → max(60 cal, 20%)
  const tol = Math.max(60, 0.2 * cal);
  const delta = Math.abs(atwater - cal);
  if (delta > tol) return { valid: false, note: `atwater-mismatch d=${Math.round(delta)} tol=${Math.round(tol)}` };
  return { valid: true, note: "ok" };
}

// ---- reconcile stub (conservative; full resolver is later) ----
export function reconcileKey(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---- extraction: forced-tool structured output over page images ----
const TOOL = {
  name: "record_nutrition",
  description: "Record every menu item and its nutrition facts found in the official nutrition document.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        description: "One entry per distinct menu item with nutrition facts.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Item name as printed" },
            serving_size: { type: "string", description: "Serving size/description, or empty" },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
          },
          required: ["name", "calories", "protein_g", "carbs_g", "fat_g"],
        },
      },
    },
    required: ["items"],
  },
};

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

export async function extractFromImages(brand: string, pngs: Buffer[]): Promise<NutritionRow[]> {
  const content: Anthropic.ContentBlockParam[] = pngs.map((b) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: "image/png" as const, data: b.toString("base64") },
  }));
  content.push({
    type: "text",
    text:
      `These are the official nutrition page(s) for "${brand}". Extract EVERY menu item with its ` +
      `nutrition facts and call record_nutrition. One row per item. Use the standard listed ` +
      `serving. Report calories and grams of protein/carbs/fat exactly as printed. If an item is ` +
      `missing any of calories/protein/carbs/fat, omit that item. Do not invent values.`,
  });

  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: MAX_OUT_TOKENS,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content }],
  });
  track(msg.usage.input_tokens, msg.usage.output_tokens);
  if (msg.stop_reason === "max_tokens") {
    console.warn(`  ⚠ truncated at ${MAX_OUT_TOKENS} output tokens — tool JSON may be partial; consider paginating this artifact`);
  }

  const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const _items = (tu?.input as { items?: unknown }) || {};
  const raw = Array.isArray(_items.items) ? _items.items : [];
  return raw.map((it) => ({
    name: String(it.name ?? "").trim(),
    servingSize: it.serving_size ? String(it.serving_size) : null,
    calories: num(it.calories), proteinG: num(it.protein_g), carbsG: num(it.carbs_g), fatG: num(it.fat_g),
  })).filter((r) => r.name.length > 0);
}
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

// ---- extraction over plain text (static-HTML route) ----
export async function extractFromText(brand: string, text: string): Promise<NutritionRow[]> {
  const msg = await client().messages.create({
    model: MODEL,
    max_tokens: MAX_OUT_TOKENS,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content:
      `The following is text scraped from the official nutrition page for "${brand}". Extract EVERY ` +
      `menu item with complete nutrition facts and call record_nutrition. One row per item; calories ` +
      `and grams of protein/carbs/fat as printed. Omit items missing any of those four. Do not invent.\n\n` +
      text.slice(0, 120_000) }],
  });
  track(msg.usage.input_tokens, msg.usage.output_tokens);
  if (msg.stop_reason === "max_tokens") console.warn(`  ⚠ truncated — page may need chunking`);
  const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const _items = (tu?.input as { items?: unknown }) || {};
  const raw = Array.isArray(_items.items) ? _items.items : [];
  return raw.map((it) => ({
    name: String(it.name ?? "").trim(), servingSize: it.serving_size ? String(it.serving_size) : null,
    calories: num(it.calories), proteinG: num(it.protein_g), carbsG: num(it.carbs_g), fatG: num(it.fat_g),
  })).filter((r) => r.name.length > 0);
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Browser-like headers — many sites 403 a bare UA fetch.
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/pdf,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none",
};
// Fetch via curl — node's fetch TLS fingerprint is bot-blocked (403) by Akamai/Cloudflare
// on several chain sites; curl passes. Returns raw bytes (callers decode/write as needed).
export function curlBytes(url: string): Buffer {
  // Bare curl (default UA): beats node-fetch's TLS-fingerprint block AND avoids WAFs that
  // paradoxically block browser-spoofing UAs (e.g. itsbobatime.com 403s a Chrome UA, 200s curl).
  return execFileSync("curl", ["-sL", "--compressed", "--max-time", "20", url], { maxBuffer: 64 * 1024 * 1024 });
}
export async function fetchHtml(url: string): Promise<string> {
  return curlBytes(url).toString("utf8");
}
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}
export async function extractStaticHtml(url: string, brand: string): Promise<ChainItemRow[]> {
  const text = stripHtml(await fetchHtml(url));
  const rows = await extractFromText(brand, text);
  return rows.map((r) => { const v = validateRow(r); return { ...r, canonicalKey: reconcileKey(r.name), valid: v.valid, validationNote: v.note }; });
}

// ---- PDF route: render to PNG (downscaled), then extract ----
export async function renderPdfToPngs(pdfPath: string): Promise<Buffer[]> {
  const dir = mkdtempSync(join(tmpdir(), "p1pdf-"));
  // pdftoppm -png -r DPI -l MAXPAGES <pdf> <prefix>  → prefix-1.png ...
  execFileSync("pdftoppm", ["-png", "-r", String(RENDER_DPI), "-l", String(MAX_PAGES), pdfPath, join(dir, "p")]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const out: Buffer[] = [];
  for (const f of files) {
    out.push(await sharp(join(dir, f)).resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: "inside", withoutEnlargement: true }).png().toBuffer());
  }
  return out;
}

const TILE_BANDS = 2;   // split each page into N horizontal bands → fewer items/image → model enumerates more completely
const TILE_OVERLAP = 0.06; // band overlap so rows straddling a cut aren't lost (dedup handles the double)
const CHUNK_TILES = 2;  // tiles per API call — bounds output tokens

// Split a page PNG into TILE_BANDS overlapping horizontal bands.
async function tilePng(buf: Buffer): Promise<Buffer[]> {
  if (TILE_BANDS <= 1) return [buf];
  const img = sharp(buf); const meta = await img.metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (!W || !H) return [buf];
  const band = Math.ceil(H / TILE_BANDS), ov = Math.round(band * TILE_OVERLAP);
  const out: Buffer[] = [];
  for (let i = 0; i < TILE_BANDS; i++) {
    const top = Math.max(0, i * band - ov);
    const height = Math.min(H - top, band + 2 * ov);
    out.push(await sharp(buf).extract({ left: 0, top, width: W, height }).png().toBuffer());
  }
  return out;
}

export async function extractPdf(pdfPath: string, brand: string): Promise<ChainItemRow[]> {
  const pngs = await renderPdfToPngs(pdfPath);
  const tiles: Buffer[] = [];
  for (const pg of pngs) tiles.push(...(await tilePng(pg)));
  const merged = new Map<string, NutritionRow>(); // dedupe by canonicalKey, keep first
  for (let i = 0; i < tiles.length; i += CHUNK_TILES) {
    const chunk = tiles.slice(i, i + CHUNK_TILES);
    const rows = await extractFromImages(brand, chunk);
    for (const r of rows) {
      const k = reconcileKey(r.name);
      if (k && !merged.has(k)) merged.set(k, r);
    }
    if (tiles.length > CHUNK_TILES) console.log(`    tiles ${i + 1}-${Math.min(i + CHUNK_TILES, tiles.length)}/${tiles.length} (${pngs.length}pg×${TILE_BANDS}): ${rows.length} rows (running unique ${merged.size})`);
  }
  return [...merged.values()].map((r) => {
    const v = validateRow(r);
    return { ...r, canonicalKey: reconcileKey(r.name), valid: v.valid, validationNote: v.note };
  });
}

function writeChainItems(brandSlug: string, rows: ChainItemRow[], meta: object) {
  writeFileSync(join(OUT_DIR, `${brandSlug}.json`), JSON.stringify({ ...meta, generated: "phase1-extract", rows }, null, 2));
}

// ---- selftest: validator unit checks (M1 acceptance, no API spend) ----
function selftest() {
  const cases: [NutritionRow, boolean][] = [
    [{ name: "Chicken Bowl", servingSize: "1 bowl", calories: 640, proteinG: 38, carbsG: 100, fatG: 11 }, true], // 4*38+4*100+9*11=651 ~ ok
    [{ name: "P/C swapped", servingSize: "", calories: 640, proteinG: 100, carbsG: 38, fatG: 11 }, true],        // sum identical → swap not caught by 4/4/9 alone (P=C cost), expected limitation
    [{ name: "Dropped digit", servingSize: "", calories: 64, proteinG: 38, carbsG: 100, fatG: 11 }, false],      // atwater 651 vs 64 → caught
    [{ name: "Misread fat", servingSize: "", calories: 640, proteinG: 38, carbsG: 100, fatG: 50 }, false],       // 4*38+4*100+9*50=1002 vs 640 → caught
    [{ name: "Missing", servingSize: "", calories: 640, proteinG: null, carbsG: 100, fatG: 11 }, false],
  ];
  let pass = 0;
  for (const [row, want] of cases) {
    const got = validateRow(row).valid;
    const ok = got === want;
    if (ok) pass++;
    console.log(`${ok ? "✓" : "✗"} ${row.name.padEnd(16)} valid=${got} (want ${want})  ${validateRow(row).note}`);
  }
  console.log(`\nvalidator selftest: ${pass}/${cases.length} expectations met`);
  console.log("note: pure 4/4/9 cannot catch a P↔C swap (same calorie sum) — that's a known limit; FatSecret cross-check covers it.");
  process.exit(pass === cases.length ? 0 : 1);
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "--selftest") return selftest();
  const isHtml = arg === "--html";
  const target = isHtml ? process.argv[3]! : arg;
  const brand = (isHtml ? process.argv[4] : process.argv[3]) ?? "Unknown";
  const slug = reconcileKey(brand);
  console.log(`extracting: ${brand}  (${MODEL})  ${isHtml ? "[static-html] " : ""}from ${target}`);
  const rows = isHtml ? await extractStaticHtml(target, brand) : await extractPdf(target, brand);
  const valid = rows.filter((r) => r.valid);
  writeChainItems(slug, rows, { brand, source: arg, model: MODEL });
  console.log(`\n  rows extracted : ${rows.length}`);
  console.log(`  4/4/9 passed   : ${valid.length}`);
  console.log(`  rejected       : ${rows.length - valid.length}`);
  console.log(`  cost so far    : $${cost.usd.toFixed(4)} (${cost.inTok} in / ${cost.outTok} out tok, ${cost.calls} call)`);
  console.log(`  → scripts/phase1-out/${slug}.json`);
  console.log("\n  sample (first 5 valid):");
  for (const r of valid.slice(0, 5)) console.log(`   ${String(r.calories).padStart(4)} cal  P${r.proteinG} C${r.carbsG} F${r.fatG}  ${r.name.slice(0, 42)}`);
}

// Run the CLI only when invoked directly (not when imported by phase1-run.ts).
// Filename check (CommonJS-safe — avoids import.meta under the scripts tsconfig).
if (process.argv[1] && /phase1-extract\.[tj]s$/.test(process.argv[1])) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
