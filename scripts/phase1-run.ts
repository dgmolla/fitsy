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
 *   nutrition-page → extractStaticHtml; if it yields < MIN_ROWS valid → require manual source review
 *   site / other   → same static attempt, else defer
 * SPA + static-empty + no-official → deferred to the estimator fallback tier (still
 *   "enriched", just not via official). Every unresolved chain is listed in _manual-sources.json.
 *
 * Run:  npx tsx --env-file=.env.local scripts/phase1-run.ts [discoverFile] [maxBrands]
 *   defaults: scripts/phase1-discover-sample.json , 20
 *
 * Runbook: docs/engineering/pipeline/chain-rollout-proposals.md
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cost, extractPdf, extractStaticHtml, reconcileKey, curlBytes, type ChainItemRow } from "./phase1-extract";

const DISCOVER = process.argv[2] ?? "scripts/phase1-discover-sample.json";
const MAX_BRANDS = Number(process.argv[3] ?? 20);
if (!Number.isSafeInteger(MAX_BRANDS) || MAX_BRANDS < 1) throw new Error('maxBrands must be a positive integer');
const MIN_ROWS = 5; // Sparse extraction needs manual review; this threshold does not establish a SPA.
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
  if (!b.official || !b.outcome?.startsWith('official')) return { ...base, status: "deferred-no-official", route: "none", rows: 0, valid: 0,
    note: 'Manual source required: retain an official US nutrition PDF or rendered table, including serving sizes and source hash.' };
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
  // Sparse static output may be a SPA, a small table or an extraction failure; retain the source hold.
  return { ...base, status: b.artifactType === "pdf" ? "deferred-empty" : "deferred-spa", route, rows: rows.length, valid: valid.length,
    note: 'Manual source required: static extraction is insufficient. Retain the official US PDF or rendered nutrition table and exact serving choices; do not approve fallback estimates.' };
}

async function main() {
  const disc = JSON.parse(readFileSync(DISCOVER, "utf8")).results as DiscoverRow[];
  const gated = disc.slice(0, MAX_BRANDS);
  if (!gated.length) throw new Error('No discovered brands; refusing an empty coverage report');
  console.log(`routing ${gated.length} discovered brands (of ${disc.length})\n`);
  const results: BrandResult[] = [];
  for (const b of gated) {
    const ckpt = join(RUN_DIR, `${b.slug}.result.json`);
    if (existsSync(ckpt)) {
      const cached = JSON.parse(readFileSync(ckpt, "utf8")) as BrandResult & { checkpointVersion?: number };
      if (cached.checkpointVersion === 2 && cached.official === b.official && cached.route === (b.official && b.outcome?.startsWith('official') ? b.artifactType ?? 'site' : 'none')) {
        results.push(cached); console.log(`  ✓ ${b.display} (cached)`); continue;
      }
    }
    const r = await runBrand(b);
    writeFileSync(ckpt, JSON.stringify({ ...r, checkpointVersion: 2 }, null, 2));
    results.push(r);
    const tag = r.status === "official" ? `✓ official ${r.valid}/${r.rows}` : r.status;
    console.log(`  ${tag.padEnd(22)} ${r.display.slice(0, 26).padEnd(26)} [${r.route}]  $${cost.usd.toFixed(2)}`);
  }
  // coverage report
  const by = (s: Status) => results.filter((r) => r.status === s);
  const officialN = by("official"); const totalItems = officialN.reduce((a, r) => a + r.valid, 0);
  console.log(`\n=== coverage over ${results.length} brands ===`);
  console.log(`  official-extracted : ${officialN.length}  (${totalItems} validated items)`);
  console.log(`  deferred → SPA      : ${by("deferred-spa").length}  (manual official US source required)`);
  console.log(`  deferred → empty    : ${by("deferred-empty").length}`);
  console.log(`  deferred → no-official: ${by("deferred-no-official").length}`);
  console.log(`  errors              : ${by("error").length}`);
  console.log(`  spend               : $${cost.usd.toFixed(2)} / cap`);
  writeFileSync(join(RUN_DIR, "_coverage.json"), JSON.stringify({ generated: DISCOVER, results, spendUsd: cost.usd }, null, 2));
  writeFileSync(join(RUN_DIR, "_manual-sources.json"), JSON.stringify({ generated: DISCOVER, proposalsOnly: true,
    chains: results.filter(r => r.status !== 'official').map(r => ({ ...r,
      action: 'Capture official US nutrition with serving context, hash the retained source, then use reviewed catalog batches. No production application is authorized by this report.' })) }, null, 2));
  console.log(`\n  → ${RUN_DIR}/_coverage.json`);
}
main().catch((e) => { console.error("RUN ERROR:", e.message); process.exit(1); });
