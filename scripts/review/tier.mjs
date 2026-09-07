#!/usr/bin/env node
// stdin: newline-separated changed paths. stdout: highest matching tier.
// Deterministic; a classifier may raise, never lower (autonomous-shipping §3).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const yaml = createRequire(import.meta.url)("js-yaml");

const cfg = yaml.load(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "verify", "risk-tiers.yml"), "utf8"));
const files = readFileSync(0, "utf8").split("\n").filter(Boolean);
const toRe = (g) =>
  new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*")) + "$");
const match = (globs) => files.some((f) => globs.map(toRe).some((r) => r.test(f)));

if (match(cfg.tiers.high)) console.log("high");
else if (files.length && files.every((f) => cfg.tiers.low.map(toRe).some((r) => r.test(f)))) console.log("low");
else console.log("medium");
