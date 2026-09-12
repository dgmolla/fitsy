/** Reviewed identity onboarding. No menu items or nutrition estimates are changed. */
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { stateHash } from "../apps/api/services/chainPilotPlan";
import { planChainIdentity, readChainIdentities, applyChainIdentity, rollbackChainIdentity,
  type ChainIdentityPlan, type ChainIdentityJournal } from "../apps/api/services/chainIdentityPlan";

const [command, path, input] = process.argv.slice(2);
if (!path || !input || process.argv.length !== 5 || !["plan", "apply", "rollback"].includes(command ?? "")) {
  throw new Error("Usage: preload-chain-identity.ts plan <output> <reviewed-batch> | apply <plan-file> <hash> | rollback <journal-file> <hash>");
}
const raw = process.env["POSTGRES_URL_NON_POOLING"];
if (!raw) throw new Error("POSTGRES_URL_NON_POOLING required; choose the target explicitly");
const url = new URL(raw.trim()), target = stateHash([url.host, url.pathname, url.username]);
url.searchParams.set("connection_limit", "1");
const p = new PrismaClient({ datasources: { db: { url: url.toString() } } });
function save(file: string, value: unknown) {
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
const report = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
async function main() {
  if (command === "plan") {
    const current = await p.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return readChainIdentities(tx);
    }, { isolationLevel: "RepeatableRead", timeout: 120_000 });
    const plan = planChainIdentity(current.brands, current.restaurants, read(input!));
    save(path!, { target, plan });
    report({ brands: plan.brands.length, restaurantLinks: plan.links.length, hash: plan.hash }); return;
  }
  if (command === "apply") {
    const doc = read<{ target: string; plan: ChainIdentityPlan }>(path!);
    if (doc.target !== target || doc.plan.hash !== input) throw new Error("Identity target or explicit hash mismatch");
    save(path! + ".started.json", doc);
    const journal = await applyChainIdentity(p, doc.plan);
    save(path! + ".applied.json", { target, journal });
    report({ brands: journal.brands.length, restaurantLinks: journal.restaurants.length }); return;
  }
  const doc = read<{ target: string; journal: ChainIdentityJournal }>(path!);
  if (doc.target !== target || doc.journal.plan.hash !== input) throw new Error("Rollback target or explicit hash mismatch");
  if (existsSync(path! + ".rolled-back.json")) throw new Error("Identity journal is already rolled back");
  save(path! + `.rollback-started-${randomUUID()}.json`, { target, planHash: input });
  await rollbackChainIdentity(p, doc.journal);
  save(path! + ".rolled-back.json", { target, planHash: input });
  report({ rolledBackBrands: doc.journal.brands.length, rolledBackRestaurantLinks: doc.journal.restaurants.length });
}
main().catch(error => {
  console.error(error?.constructor?.name?.startsWith("Prisma") ? JSON.stringify({ error: error.constructor.name, code: error.code }) : error instanceof Error ? error.message : "Identity operation failed");
  process.exitCode = 1;
}).finally(() => p.$disconnect());
