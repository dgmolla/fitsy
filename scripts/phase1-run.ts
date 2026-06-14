/**
 * Phase 1 — router + batch driver (M5).
 *
 * Reads discovery output (per-brand official artifact URL + artifactType), dispatches each
 * brand through the right extraction route, validates, and writes a per-brand checkpoint.
 * Resumable (skips brands already checkpointed). Cost-capped via the shared tracker in
 * phase1-extract. Produces a coverage report: official-extracted vs deferred-to-fallback.
 *
 * Routing:
 *   pdf            → download → extractPdf (render→vision, chunked)
 *   nutrition-page → extractStaticHtml; if it yields < MIN_ROWS valid → mark SPA/empty (defer)
 *   site / other   → same static attempt, else defer
 * SPA + static-empty + no-official → deferred to the FatSecret/Haiku fallback tier (still
 *   "enriched", just not via official). The headless SPA route (M4) lands later.
 *
 * Run:  npx tsx --env-file=.env.local scripts/phase1-run.ts [discoverFile] [maxBrands]
 *   defaults: scripts/phase1-discover-sample.json , 20
 *
 * Runbook: docs/engineering/pipeline/phase1-extraction-execution.md
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cost, extractPdf, extractStaticHtml, reconcileKey, curlBytes, type ChainItemRow } from "./phase1-extract";

const DISCOVER = process.argv[2] ?? "scripts/phase1-discover-sample.json";
const MAX_BRANDS = Number(process.argv[3] ?? 20);
const MIN_ROWS = 5; // fewer valid official rows than this → treat artifact as SPA/empty, defer
const RUN_DIR = "scripts/phase1-out/run";
mkdirSync(RUN_DIR, { recursive: true });

interface DiscoverRow { slug: string; display: string; official: string | null; artifactType: string | null; outcome: string }
type Status = "official" | "deferred-spa" | "deferred-empty" | "deferred-no-official" | "error";
interface BrandResult { slug: string; display: string; status: Status; route: string; rows: number; valid: number; official: string | null; note?: string }

async function downloadPdf(url: string): Promise<string> {
  const buf = curlBytes(url); // curl beats node-fetch TLS bot-blocks
  if (buf.length < 1000 || !buf.subarray(0, 5).toString().includes("%PDF")) throw new Error(`not a PDF (${buf.length}b)`);
  const p = join(tmpdir(), `p1-${reconcileKey(url).slice(-40)}.pdf`);
  writeFileSync(p, buf);
  return p;
}

async function runBrand(b: DiscoverRow): Promise<BrandResult> {
  const base = { slug: b.slug, display: b.display, official: b.official };
  if (!b.official) return { ...base, status: "deferred-no-official", route: "none", rows: 0, valid: 0 };
  let rows: ChainItemRow[] = [];
  let route = b.artifactType ?? "site";
  try {
    if (b.artifactType === "pdf") {
      const p = await downloadPdf(b.official);
      rows = await extractPdf(p, b.display);
    } else {
      rows = await extractStaticHtml(b.official, b.display); // nutrition-page / site
    }
  } catch (e) {
    return { ...base, status: "error", route, rows: 0, valid: 0, note: (e as Error).message };
  }
  const valid = rows.filter((r) => r.valid);
  writeFileSync(join(RUN_DIR, `${b.slug}.json`), JSON.stringify({ ...base, route, rows }, null, 2));
  if (valid.length >= MIN_ROWS) return { ...base, status: "official", route, rows: rows.length, valid: valid.length };
  // static route came back near-empty → almost certainly a JS-SPA (or a thin page): defer
  return { ...base, status: b.artifactType === "pdf" ? "deferred-empty" : "deferred-spa", route, rows: rows.length, valid: valid.length };
}

async function main() {
  const disc = JSON.parse(readFileSync(DISCOVER, "utf8")).results as DiscoverRow[];
  const gated = disc.filter((d) => d.outcome?.startsWith("official")).slice(0, MAX_BRANDS);
  console.log(`routing ${gated.length} brands with official artifacts (of ${disc.length} discovered)\n`);
  const results: BrandResult[] = [];
  for (const b of gated) {
    const ckpt = join(RUN_DIR, `${b.slug}.result.json`);
    if (existsSync(ckpt)) { results.push(JSON.parse(readFileSync(ckpt, "utf8"))); console.log(`  ✓ ${b.display} (cached)`); continue; }
    const r = await runBrand(b);
    writeFileSync(ckpt, JSON.stringify(r, null, 2));
    results.push(r);
    const tag = r.status === "official" ? `✓ official ${r.valid}/${r.rows}` : r.status;
    console.log(`  ${tag.padEnd(22)} ${r.display.slice(0, 26).padEnd(26)} [${r.route}]  $${cost.usd.toFixed(2)}`);
  }
  // coverage report
  const by = (s: Status) => results.filter((r) => r.status === s);
  const officialN = by("official"); const totalItems = officialN.reduce((a, r) => a + r.valid, 0);
  console.log(`\n=== coverage over ${results.length} brands ===`);
  console.log(`  official-extracted : ${officialN.length}  (${totalItems} validated items)`);
  console.log(`  deferred → SPA      : ${by("deferred-spa").length}  (need M4 headless or fallback tier)`);
  console.log(`  deferred → empty    : ${by("deferred-empty").length}`);
  console.log(`  deferred → no-official: ${by("deferred-no-official").length}`);
  console.log(`  errors              : ${by("error").length}`);
  console.log(`  spend               : $${cost.usd.toFixed(2)} / cap`);
  writeFileSync(join(RUN_DIR, "_coverage.json"), JSON.stringify({ generated: DISCOVER, results, spendUsd: cost.usd }, null, 2));
  console.log(`\n  → ${RUN_DIR}/_coverage.json`);
}
main().catch((e) => { console.error("RUN ERROR:", e.message); process.exit(1); });
