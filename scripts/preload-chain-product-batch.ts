/** Pure offline compilation. Source review and guarded production application are separate steps. */
import { readFileSync, writeFileSync } from "node:fs";
import { compileChainProductBatch } from "../apps/api/services/chainProductBatch";
const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) throw new Error("Usage: preload-chain-product-batch.ts <reviewed-input.json> <new-output.json>");
const batch = compileChainProductBatch(JSON.parse(readFileSync(input, "utf8")));
writeFileSync(output, JSON.stringify(batch, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ changes: batch.changes.length, quarantine: batch.quarantine.length }) + "\n");
