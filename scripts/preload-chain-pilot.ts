/** Offline catalog batches + existing-menu updates. The original seven-serving pilot remains the default. */
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chainPilot } from "../apps/api/services/chainPilotData";
import { chainCatalogBatchSchema } from "../apps/api/services/chainCatalogBatch";
import { planChainPilot, applyCatalogPlan, rollbackCatalogPlan, stateHash, type CatalogPlan } from "../apps/api/services/chainPilotPlan";
import { applyAprilChainMatch, aprilMenuIdentity, officialMacro, AprilPlanChangedError, verifiedBrand } from "../apps/api/services/chainServing";
import { buildChainMatcher, chainMenuFingerprint, type ApprovedChainRow } from "../apps/api/services/chainCatalog";
import { rollbackAprilBatch, type AprilSnapshot } from "../apps/api/services/chainPilotRollback";
import { applyAprilChainBatch, MAX_APRIL_CHUNK } from "../apps/api/services/chainAprilBatch";
import { readAprilJournals } from "./chain-april-journal";
import { pickWinningEstimate } from "../packages/shared/src/utils/macroProvenance";

const args = process.argv.slice(2), options = args.filter(a => a.startsWith("--"));
const [command, path, expectedHash] = args.filter(a => !a.startsWith("--"));
if (!path || !["menu-inventory", "catalog-plan", "catalog-apply", "catalog-rollback", "april-plan", "april-apply", "april-rollback"].includes(command ?? "")) {
  throw new Error("Usage: preload-chain-pilot.ts <menu-inventory|catalog-plan|catalog-apply|catalog-rollback|april-plan|april-apply|april-rollback> <path> [plan-hash] [--batch=manifest.json] [--limit=N] [--chunk-size=1..100]");
}
if (options.some(a => !a.startsWith("--batch=") && !a.startsWith("--limit=") && !a.startsWith("--chunk-size=")) || options.filter(a => a.startsWith("--batch=")).length > 1) throw new Error("Unknown or duplicate batch option");
if (options.filter(a => a.startsWith("--chunk-size=")).length > 1 || (command !== "april-apply" && options.some(a => a.startsWith("--chunk-size=")))) throw new Error("Chunk size applies only to April apply");
const chunkText = options.find(a => a.startsWith("--chunk-size="))?.slice(13) ?? "1";
const chunkSize = Number(chunkText);
if (!/^\d+$/.test(chunkText) || !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_APRIL_CHUNK) throw new Error("Invalid April chunk size");
const batchPath = options.find(a => a.startsWith("--batch="))?.slice(8);
const batch = chainCatalogBatchSchema.parse(batchPath === undefined ? chainPilot : JSON.parse(readFileSync(batchPath, "utf8")));
const slugs = [...new Set([...batch.changes, ...batch.quarantine].map(row => row.slug))];
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
  const brands = await p.brand.findMany({ where: { slug: { in: slugs } } });
  const catalog = await p.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) } } });
  return { brands, catalog };
}
async function main() {
  if (command === "menu-inventory") {
    const { brands } = await inventory();
    const items = await p.menuItem.findMany({ where: { restaurant: { brandId: { in: brands.map(b => b.id) } } },
      select: { id: true, name: true, section: true, description: true, restaurant: { select: { brandId: true } } }, orderBy: { id: "asc" } });
    const variants = new Map<string, { slug: string; name: string; section: string; description: string; itemIds: string[] }>();
    for (const item of items) {
      const identity = { name: item.name, section: item.section ?? "", description: item.description ?? "" };
      const slug = brands.find(b => b.id === item.restaurant.brandId)!.slug, key = slug + ":" + chainMenuFingerprint(identity);
      const group = variants.get(key) ?? { slug, ...identity, itemIds: [] };
      group.itemIds.push(item.id); variants.set(key, group);
    }
    save(path!, { target, variants: [...variants.values()] }); report({ inspected: items.length, uniqueVariants: variants.size }); return;
  }
  if (command === "catalog-plan") {
    const { brands, catalog } = await inventory(), plan = planChainPilot(brands, catalog, batch);
    const doc = { target, kind: "catalog" as const, hash: plan.hash, catalog: plan };
    save(path!, doc); report({ changes: plan.changes.length, hash: doc.hash }); return;
  }
  if (command === "april-plan") {
    const { brands, catalog } = await inventory();
    if (planChainPilot(brands, catalog, batch).changes.length) throw new Error("Apply and verify the catalog pilot first (or the selected batch)");
    const verified = await p.brand.findMany({ where: { detectionConf: { in: ["high", "llm-confirmed"] }, menuKind: "restaurant" } });
    const restaurants = await p.restaurant.findMany({ where: { brandId: { in: brands.map(b => b.id) } }, select: { id: true, name: true, brandId: true } });
    const match = buildChainMatcher(catalog), byRestaurant = new Map(restaurants.map(r => [r.id, verifiedBrand(r, verified)]));
    const unresolvedRestaurants = restaurants.filter(r => !byRestaurant.get(r.id));
    const items = await p.menuItem.findMany({ where: { restaurantId: { in: [...byRestaurant.keys()] } }, include: { macroEstimates: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
    const rows: AprilEntry[] = [];
    for (const before of items) {
      const result = match(byRestaurant.get(before.restaurantId), aprilMenuIdentity(before));
      if (result.status !== "matched" || !batch.changes.some(c => c.canonicalKey === result.row.canonicalKey && brands.find(b => b.slug === c.slug)?.id === result.row.brandId)) continue;
      const expected = officialMacro(result.row, aprilMenuIdentity(before)), prior = before.macroEstimates.find(e => e.source === "official"), winner = pickWinningEstimate(before.macroEstimates);
      const keys = ["calories", "proteinG", "carbsG", "fatG"] as const;
      if (prior?.reasoning === expected.reasoning && prior.confidence === "HIGH" && !prior.hadPhoto && prior.ingredientBreakdown === null && keys.every(k => prior[k] === expected[k] && before[k] === winner?.[k])) continue;
      rows.push({ before, approved: result.row });
    }
    // Canary order exercises one published configuration from each brand first.
    const leaders = (batchPath === undefined ? ["chicken-plate", "gyudon-beef-side"].map(key => rows.find(r => r.approved.canonicalKey === key))
      : brands.map(brand => rows.find(r => r.approved.brandId === brand.id))).filter((r): r is AprilEntry => !!r);
    const ordered = [...leaders, ...rows.filter(r => !leaders.includes(r))];
    const doc: PlanFile = { target, kind: "april", hash: stateHash(ordered), rows: ordered };
    save(path!, doc); report({ matched: rows.length, inspected: items.length, restaurants: new Set(rows.map(r => r.before.restaurantId)).size, unresolvedRestaurants, hash: doc.hash }); return;
  }
  if (command === "april-rollback") {
    const journals = readAprilJournals(path!, target);
    await rollbackAprilBatch(p, journals);
    report({ rolledBack: journals.length, expected: journals.length }); return;
  }
  if (command === "catalog-rollback") {
    // Operator ordering is deliberate: roll back all April batches before their catalog approvals.
    const doc = read<{ target: string; plan: CatalogPlan; after: Awaited<ReturnType<typeof applyCatalogPlan>> }>(path!);
    if (doc.target !== target) throw new Error("Database target differs from the journal");
    await rollbackCatalogPlan(p, doc.plan, doc.after); report({ rolledBack: doc.after.length }); return;
  }
  const doc = read<PlanFile>(path!);
  if (doc.target !== target || !expectedHash || expectedHash !== doc.hash) throw new Error("Database target or explicit plan hash mismatch");
  if (command === "catalog-apply") {
    if (doc.kind !== "catalog" || !doc.catalog) throw new Error("Expected a catalog plan");
    save(path! + ".started.json", doc);
    const after = await applyCatalogPlan(p, doc.catalog, batch);
    save(path! + ".applied.json", { target, plan: doc.catalog, after });
    report({ applied: after.length }); return;
  }
  if (doc.kind !== "april" || !doc.rows || stateHash(doc.rows) !== doc.hash) throw new Error("Expected an intact April plan");
  const limitText = options.find(a => a.startsWith("--limit="))?.slice(8) ?? "2";
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > doc.rows.length) throw new Error("Invalid apply limit");
  const directory = path! + ".journal"; mkdirSync(directory);
  save(join(directory, "started.json"), { target, planHash: doc.hash, count: limit, ...(chunkSize > 1 ? { chunkSize } : {}) });
  if (chunkSize > 1) {
    for (let start = 0; start < limit; start += chunkSize) {
      const selected = doc.rows.slice(start, Math.min(start + chunkSize, limit));
      save(join(directory, `chunk-${start}.started.json`), { target, planHash: doc.hash, start, count: selected.length });
      let after: AprilSnapshot[];
      try { after = await applyAprilChainBatch(p, selected); }
      catch (error) {
        if (error instanceof AprilPlanChangedError) save(join(directory, "stopped.json"), { target, planHash: doc.hash, count: start });
        throw error;
      }
      const entries = selected.map((entry, i) => ({ before: entry.before, after: after[i]! }));
      save(join(directory, `chunk-${start}.json`), { target, planHash: doc.hash, start, entries, hash: stateHash({ start, entries }) });
      for (const entry of entries) {
        const winner = pickWinningEstimate(entry.after.macroEstimates);
        if (!winner || ["calories", "proteinG", "carbsG", "fatG"].some(key => entry.after[key as "calories"] !== winner[key as "calories"])) throw new Error("Post-write winner mismatch; roll back the journal");
      }
      report({ appliedSoFar: start + selected.length, total: limit });
    }
    report({ applied: limit, remainingInPlan: doc.rows.length - limit, journal: directory }); return;
  }
  for (const [index, entry] of doc.rows.slice(0, limit).entries()) {
    let after: AprilSnapshot;
    try { after = await applyAprilChainMatch(p, { ...entry.before, updatedAt: new Date(entry.before.updatedAt) }, entry.approved); }
    catch (error) {
      // These typed guards run before writes. Unknown DB/commit failures deliberately have no stopped marker.
      if (error instanceof AprilPlanChangedError) save(join(directory, "stopped.json"), { target, planHash: doc.hash, count: index });
      throw error;
    }
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
