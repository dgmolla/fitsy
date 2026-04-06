/**
 * Discover real UberEats store URLs for hero eval chains.
 *
 * UberEats store pages require a location-specific UUID suffix
 * (e.g. /store/mcdonalds-los-angeles/AbCd1234) that can't be guessed from the
 * chain name alone. This script uses Firecrawl search to find the real URL for
 * each chain and prints a patch for ground-truth.json.
 *
 * Usage:
 *   npx tsx scripts/eval/hero-eval/discover-urls.ts
 *
 * Requires:
 *   - FIRECRAWL_API_KEY in apps/api/.env.local or process env
 *
 * Outputs each chain's discovered URL. Copy the results into ground-truth.json
 * as uberEatsUrl values. Re-run anytime URLs become stale (UberEats rotates UUIDs).
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { discoverUberEatsUrl } from "../../../apps/api/services/menuSources/uberEatsSource.js";

// Use a representative LA location to anchor the search
const LA_ADDRESS = "Los Angeles, CA";

dotenv.config({ path: path.join(__dirname, "../../../apps/api/.env.local") });

interface GroundTruthChain {
  name: string;
  ffnSlug: string;
  uberEatsSlug: string;
  uberEatsUrl?: string;
  items: unknown[];
}
interface GroundTruth {
  chains: GroundTruthChain[];
}

async function main(): Promise<void> {
  if (!process.env["FIRECRAWL_API_KEY"]) {
    console.error("FIRECRAWL_API_KEY not set. Set it in apps/api/.env.local.");
    process.exit(1);
  }

  const gtPath = path.join(__dirname, "ground-truth.json");
  const groundTruth: GroundTruth = JSON.parse(fs.readFileSync(gtPath, "utf-8"));

  console.log("Discovering UberEats URLs via Firecrawl search...\n");

  const results: Record<string, string> = {};

  for (const chain of groundTruth.chains) {
    process.stdout.write(`  ${chain.name.padEnd(22)} → `);
    const url = await discoverUberEatsUrl(chain.name, LA_ADDRESS);
    if (url) {
      results[chain.name] = url;
      console.log(url);
    } else {
      results[chain.name] = "";
      console.log("[NOT FOUND]");
    }
  }

  console.log("\n── Patch for ground-truth.json ──────────────────────────────────────");
  console.log('Copy the "uberEatsUrl" values below into ground-truth.json:\n');
  for (const [name, url] of Object.entries(results)) {
    const display = url || "(empty — needs manual lookup)";
    console.log(`  ${JSON.stringify(name)}: ${JSON.stringify(url)}   // ${display}`);
  }

  // Optionally auto-patch: write discovered URLs back into ground-truth.json
  const shouldPatch = process.argv.includes("--write");
  if (shouldPatch) {
    let changed = 0;
    for (const chain of groundTruth.chains) {
      const discovered = results[chain.name];
      if (discovered && discovered !== chain.uberEatsUrl) {
        chain.uberEatsUrl = discovered;
        changed++;
      }
    }
    if (changed > 0) {
      fs.writeFileSync(gtPath, JSON.stringify(groundTruth, null, 2) + "\n");
      console.log(`\n✓ Wrote ${changed} URL(s) to ground-truth.json`);
    } else {
      console.log("\nNo changes to write.");
    }
  } else {
    console.log("\nRun with --write to auto-patch ground-truth.json.");
  }
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
