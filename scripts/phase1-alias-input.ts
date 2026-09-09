import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Producer and consumer import the same name. Raw/medium aliases are never landing inputs.
export const VERIFIED_ALIASES_FILENAME = "aliases-high.json";
const aliasesSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.array(z.string().trim().min(1))));
export function loadVerifiedAliases(directory: string): Record<string, Record<string, string[]>> {
  const path = join(directory, VERIFIED_ALIASES_FILENAME);
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch { throw new Error(`Missing verified aliases: ${path}. Run phase1-verify-aliases.ts first; raw aliases cannot be landed.`); }
  return aliasesSchema.parse(JSON.parse(raw));
}
