/** Offline, explicit plan/apply/rollback for the reviewed WaBa + Yoshinoya pilot. No writes by default. */
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chainPilot } from "../apps/api/services/chainPilotData";
import { planChainPilot, applyCatalogPlan, rollbackCatalogPlan, stateHash, type CatalogPlan } from "../apps/api/services/chainPilotPlan";
import { applyAprilChainMatch, aprilMenuIdentity, officialMacro } from "../apps/api/services/chainServing";
import { buildChainMatcher, type ApprovedChainRow } from "../apps/api/services/chainCatalog";
import { rollbackAprilPatch, type AprilSnapshot, type AprilJournal } from "../apps/api/services/chainPilotRollback";
import { pickWinningEstimate } from "../packages/shared/src/utils/macroProvenance";

const [command, path, expectedHash, ...options] = process.argv.slice(2);
if (!path || !["catalog-plan", "catalog-apply", "catalog-rollback", "april-plan", "april-apply", "april-rollback"].includes(command ?? "")) {
  throw new Error("Usage: preload-chain-pilot.ts <catalog|april>-<plan|apply|rollback> <path> [plan-hash] [--limit=N]");
}
const rawUrl = process.env["POSTGRES_URL_NON_POOLING"];
if (!rawUrl) throw new Error("POSTGRES_URL_NON_POOLING is required; choose the target explicitly");
let url: URL;
try { url = new URL(rawUrl.trim()); } catch { throw new Error("Invalid database URL"); }
const target = stateHash([url.host, url.pathname, url.username]);
url.searchParams.set("connection_limit", "1");
const p = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const report = (data: unknown) => process.stdout.write(JSON.stringify(data) + "\n");
function save(file: string, data: unknown) {
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(data, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
const read = <T>(file: string) => JSON.parse(readFileSync(file, "utf8")) as T;
interface AprilEntry { before: AprilSnapshot; approved: ApprovedChainRow }
interface PlanFile { target: string; kind: "catalog" | "april"; hash: string; catalog?: CatalogPlan; rows?: AprilEntry[] }
async function inventory() {
  const brands = await p.brand.findMany({ where: { slug: { in: ["waba-grill", "yoshinoya"] } } });
  const catalog = await p.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) } } });
  return { brands, catalog };
}
async function main() {
  if (command === "catalog-plan") {
    const { brands, catalog } = await inventory(), plan = planChainPilot(brands, catalog);
    const doc = { target, kind: "catalog" as const, hash: plan.hash, catalog: plan };
    save(path!, doc); report({ changes: plan.changes.length, hash: doc.hash }); return;
  }
  if (command === "april-plan") {
    const { brands, catalog } = await inventory();
    if (planChainPilot(brands, catalog).changes.length) throw new Error("Apply and verify the catalog pilot first");
    const match = buildChainMatcher(catalog), byRestaurant = new Map((await p.restaurant.findMany({ where: { brandId: { in: brands.map(b => b.id) } }, select: { id: true, brandId: true } })).map(r => [r.id, r.brandId!]));
    const items = await p.menuItem.findMany({ where: { restaurantId: { in: [...byRestaurant.keys()] } }, include: { macroEstimates: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
    const rows: AprilEntry[] = [];
    for (const before of items) {
      const result = match(byRestaurant.get(before.restaurantId), aprilMenuIdentity(before));
      if (result.status !== "matched" || !chainPilot.changes.some(c => c.canonicalKey === result.row.canonicalKey)) continue;
      const expected = officialMacro(result.row, aprilMenuIdentity(before)), prior = before.macroEstimates.find(e => e.source === "official"), winner = pickWinningEstimate(before.macroEstimates);
      const keys = ["calories", "proteinG", "carbsG", "fatG"] as const;
      if (prior?.reasoning === expected.reasoning && prior.confidence === "HIGH" && !prior.hadPhoto && prior.ingredientBreakdown === null && keys.every(k => prior[k] === expected[k] && before[k] === winner?.[k])) continue;
      rows.push({ before, approved: result.row });
    }
    // Canary order exercises one published configuration from each brand first.
    const leaders = ["chicken-plate", "gyudon-beef-side"].map(key => rows.find(r => r.approved.canonicalKey === key)).filter((r): r is AprilEntry => !!r);
    const ordered = [...leaders, ...rows.filter(r => !leaders.includes(r))];
    const doc: PlanFile = { target, kind: "april", hash: stateHash(ordered), rows: ordered };
    save(path!, doc); report({ matched: rows.length, inspected: items.length, restaurants: new Set(rows.map(r => r.before.restaurantId)).size, hash: doc.hash }); return;
  }
  if (command === "april-rollback") {
    const info = read<{ target: string }>(join(path!, "started.json"));
    if (info.target !== target) throw new Error("Database target differs from the journal");
    const files = readdirSync(path!).filter(f => /^\d+\.json$/.test(f)).sort((a, b) => Number(b.split(".")[0]) - Number(a.split(".")[0]));
    for (const file of files) await rollbackAprilPatch(p, read<AprilJournal>(join(path!, file)));
    report({ rolledBack: files.length }); return;
  }
  if (command === "catalog-rollback") {
    const doc = read<{ target: string; plan: CatalogPlan; after: Awaited<ReturnType<typeof applyCatalogPlan>> }>(path!);
    if (doc.target !== target) throw new Error("Database target differs from the journal");
    await rollbackCatalogPlan(p, doc.plan, doc.after); report({ rolledBack: doc.after.length }); return;
  }
  const doc = read<PlanFile>(path!);
  if (doc.target !== target || !expectedHash || expectedHash !== doc.hash) throw new Error("Database target or explicit plan hash mismatch");
  if (command === "catalog-apply") {
    if (doc.kind !== "catalog" || !doc.catalog) throw new Error("Expected a catalog plan");
    save(path! + ".started.json", doc);
    const after = await applyCatalogPlan(p, doc.catalog);
    save(path! + ".applied.json", { target, plan: doc.catalog, after });
    report({ applied: after.length }); return;
  }
  if (doc.kind !== "april" || !doc.rows || stateHash(doc.rows) !== doc.hash) throw new Error("Expected an intact April plan");
  const limitText = options.find(a => a.startsWith("--limit="))?.slice(8) ?? "2";
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > doc.rows.length) throw new Error("Invalid apply limit");
  const directory = path! + ".journal"; mkdirSync(directory);
  save(join(directory, "started.json"), { target, planHash: doc.hash, count: limit });
  for (const [index, entry] of doc.rows.slice(0, limit).entries()) {
    const after = await applyAprilChainMatch(p, { ...entry.before, updatedAt: new Date(entry.before.updatedAt) }, entry.approved);
    save(join(directory, `${index}.json`), { before: entry.before, after });
    const winner = pickWinningEstimate(after.macroEstimates);
    if (!winner || ["calories", "proteinG", "carbsG", "fatG"].some(key => after[key as "calories"] !== winner[key as "calories"])) throw new Error("Post-write winner mismatch; roll back the journal");
  }
  report({ applied: limit, remainingInPlan: doc.rows.length - limit, journal: directory });
}
main().catch(error => {
  console.error(error?.constructor?.name?.startsWith("Prisma") ? JSON.stringify({ error: error.constructor.name, code: error.code }) : error instanceof Error ? error.message : "Pilot operation failed");
  process.exitCode = 1;
}).finally(() => p.$disconnect());
