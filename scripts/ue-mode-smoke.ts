/**
 * Smoke test the UE_API_MODE wiring on a small set of live URLs.
 *
 * Runs the UberEatsSource.lookup() path against 3 cached restaurants
 * in each mode (disabled, primary, shadow) and reports items/status.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ue-mode-smoke.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UberEatsSource } from "../apps/api/services/menuSources/uberEatsSource.js";

async function lookupOne(name: string, url: string): Promise<{ items: number; source: string; mismatch: boolean | undefined }> {
  const src = new UberEatsSource(url);
  const result = await src.lookup(name, "");
  return {
    items: result.items.length,
    source: result.sourceId,
    mismatch: result.nameMismatch,
  };
}

async function runMode(mode: "disabled" | "primary" | "shadow", entries: Array<[string, string]>) {
  process.env["UE_API_MODE"] = mode;
  console.log(`\n── UE_API_MODE=${mode} ──────────────────────────────`);
  for (const [name, url] of entries) {
    const t0 = Date.now();
    try {
      const r = await lookupOne(name, url);
      const ms = Date.now() - t0;
      console.log(`  ${name.padEnd(32)} items=${String(r.items).padStart(3)}  ${ms}ms`);
    } catch (err) {
      console.log(`  ${name.padEnd(32)} ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main() {
  const cachePath = join(process.cwd(), "scripts", "cache", "ue-discovered-urls.json");
  const urls = JSON.parse(readFileSync(cachePath, "utf-8")) as Record<string, string>;
  const entries = Object.entries(urls).slice(0, 3);

  await runMode("disabled", entries);
  await runMode("primary", entries);
  await runMode("shadow", entries);
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
