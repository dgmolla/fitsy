/**
 * Phase 0 spike for the UberEats getStoreV1 API path.
 *
 * Runs `extractMenuViaApi` against a set of UE store URLs and prints a
 * summary table: name, status (ok/no-uuid/fetch-fail/empty), items, ms.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ue-api-spike.ts [--limit N] [--filter regex]
 *
 * Input: `scripts/cache/ue-discovered-urls.json` — a `{ name: url }` map.
 *
 * --filter  keep only entries whose name matches the regex (case-insensitive)
 * --limit   cap the number of URLs tested (default: all)
 * --concurrency  parallel API calls (default: 4)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractMenuViaApi } from "../apps/api/services/menuSources/ueApiClient.js";

interface SpikeRow {
  name: string;
  url: string;
  status: "ok" | "no-uuid" | "fetch-fail-or-empty";
  items: number;
  priced: number;
  ms: number;
  sample: string | null;
}

function parseArgs(argv: string[]): { limit?: number; filter?: RegExp; concurrency: number } {
  const out: { limit?: number; filter?: RegExp; concurrency: number } = { concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--filter") out.filter = new RegExp(argv[++i]!, "i");
    else if (a === "--concurrency") out.concurrency = Number(argv[++i]);
  }
  return out;
}

async function runOne(name: string, url: string): Promise<SpikeRow> {
  const t0 = Date.now();
  const result = await extractMenuViaApi(url, { timeoutMs: 10_000 });
  const ms = Date.now() - t0;

  if (!result) {
    // Distinguish "URL has no UUID" from "fetch/parse failed"
    const hasUuid = /\/store\/[^/]+\/[A-Za-z0-9_-]{22}(?:[/?#]|$)/.test(url);
    return {
      name,
      url,
      status: hasUuid ? "fetch-fail-or-empty" : "no-uuid",
      items: 0,
      priced: 0,
      ms,
      sample: null,
    };
  }

  const priced = result.items.filter((i) => typeof i.price === "number").length;
  return {
    name,
    url,
    status: "ok",
    items: result.items.length,
    priced,
    ms,
    sample: result.items[0]?.name ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const cachePath = join(process.cwd(), "scripts", "cache", "ue-discovered-urls.json");
  const raw = readFileSync(cachePath, "utf-8");
  const urls = JSON.parse(raw) as Record<string, string>;

  let entries = Object.entries(urls);
  if (args.filter) entries = entries.filter(([name]) => args.filter!.test(name));
  if (args.limit) entries = entries.slice(0, args.limit);

  console.log(
    `\nSpiking ${entries.length} URLs (concurrency=${args.concurrency}, timeout=10s)\n`,
  );

  const rows: SpikeRow[] = [];
  for (let i = 0; i < entries.length; i += args.concurrency) {
    const batch = entries.slice(i, i + args.concurrency);
    const results = await Promise.all(batch.map(([name, url]) => runOne(name, url)));
    for (const row of results) {
      rows.push(row);
      const status = row.status.padEnd(20);
      const items = String(row.items).padStart(3);
      const priced = String(row.priced).padStart(3);
      const ms = String(row.ms).padStart(5);
      const name = row.name.slice(0, 38).padEnd(38);
      const sample = row.sample ? `  [${row.sample.slice(0, 40)}]` : "";
      console.log(`  ${name} ${status} ${items} items  ${priced} priced  ${ms}ms${sample}`);
    }
  }

  // Summary
  const ok = rows.filter((r) => r.status === "ok").length;
  const noUuid = rows.filter((r) => r.status === "no-uuid").length;
  const fail = rows.filter((r) => r.status === "fetch-fail-or-empty").length;
  const avgItems = ok > 0
    ? (rows.filter((r) => r.status === "ok").reduce((a, r) => a + r.items, 0) / ok).toFixed(1)
    : "0";
  const avgMs = rows.length > 0
    ? (rows.reduce((a, r) => a + r.ms, 0) / rows.length).toFixed(0)
    : "0";

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`Total:             ${rows.length}`);
  console.log(`  ok:              ${ok}  (${((ok / rows.length) * 100).toFixed(0)}%)`);
  console.log(`  no-uuid:         ${noUuid}`);
  console.log(`  fetch-fail/empty: ${fail}`);
  console.log(`Avg items (ok):    ${avgItems}`);
  console.log(`Avg latency:       ${avgMs}ms`);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
