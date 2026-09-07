#!/usr/bin/env node
// stdin: newline-separated changed paths. stdout: highest matching tier.
// Deterministic; a classifier may raise, never lower (autonomous-shipping §3).
//
// Dependency-free on purpose: the review poller runs this in a clean clone
// with no node_modules (js-yaml was unavailable there, 2026-09-07). The
// parser below covers exactly the risk-tiers.yml shape: `tiers:` -> tier
// names -> `- "glob"` items. Anything else in that file is a mistake.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseRiskTiers(text) {
  const tiers = {};
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim() || line.trim() === "tiers:") continue;
    const tierName = line.match(/^  ([a-z]+):\s*$/);
    if (tierName) {
      current = tierName[1];
      tiers[current] = [];
      continue;
    }
    const item = line.match(/^\s+-\s+"([^"]+)"\s*$/);
    if (item && current) tiers[current].push(item[1]);
  }
  return tiers;
}

const tiersFile = join(dirname(fileURLToPath(import.meta.url)), "..", "verify", "risk-tiers.yml");
const tiers = parseRiskTiers(readFileSync(tiersFile, "utf8"));
if (!tiers.high?.length || !tiers.low?.length) {
  console.error("tier.mjs: risk-tiers.yml parsed empty; failing closed to high");
  console.log("high");
  process.exit(0);
}

const files = readFileSync(0, "utf8").split("\n").filter(Boolean);
const toRe = (g) =>
  new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*")) + "$");
const match = (globs) => files.some((f) => globs.map(toRe).some((r) => r.test(f)));

if (match(tiers.high)) console.log("high");
else if (files.length && files.every((f) => tiers.low.map(toRe).some((r) => r.test(f)))) console.log("low");
else console.log("medium");
