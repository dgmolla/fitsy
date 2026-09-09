import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type Brand, type ChainItem } from "@prisma/client";
import { approvedChainRow, buildChainMatcher, chainReviewHash, type ChainCatalogRow } from "./chainCatalog";
import { chainPilot } from "./chainPilotData";

/** Stable for both Prisma Dates and the same snapshot parsed from a JSON backup. */
export function stateHash(value: unknown): string {
  const sorted = (v: unknown): unknown => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(sorted)
    : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, sorted(item)])) : v;
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}
const fields = ["canonicalKey", "aliases", "calories", "proteinG", "carbsG", "fatG", "servingSize", "source", "confidence", "officialUrl"] as const;
const facts = (row: ChainItem) => Object.fromEntries(fields.map(key => [key, row[key]]));
type Desired = Pick<ChainItem, "brandId" | typeof fields[number] | "review">;
export interface CatalogChange { before: ChainItem | null; desired: Desired }
export interface CatalogPlan { changes: CatalogChange[]; hash: string }
const reviewJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** The audited old values are a guard against overwriting concurrent or unaudited catalog edits. */
export function planChainPilot(brands: Brand[], catalog: ChainItem[], pilot = chainPilot): CatalogPlan {
  const changes: CatalogChange[] = [];
  const brandId = (slug: string) => {
    const found = brands.filter(b => b.slug === slug && ["high", "llm-confirmed"].includes(b.detectionConf ?? "") && b.menuKind === "restaurant");
    if (found.length !== 1) throw new Error(`Verified brand missing or ambiguous: ${slug}`);
    return found[0]!.id;
  };
  const find = (id: string, key: string) => catalog.find(r => r.brandId === id && r.canonicalKey === key) ?? null;
  const append = (before: ChainItem | null, desired: Desired, expected: unknown) => {
    if (before && stateHash({ ...facts(before), brandId: before.brandId, review: before.review }) === stateHash(desired)) return;
    if (before?.review || stateHash(before ? facts(before) : null) !== stateHash(expected)) throw new Error(`Catalog differs from audited baseline: ${desired.canonicalKey}`);
    changes.push({ before, desired });
  };
  for (const definition of pilot.changes) {
    const id = brandId(definition.slug), before = find(id, definition.canonicalKey);
    const row: ChainCatalogRow = { id: before?.id ?? `${id}:${definition.canonicalKey}`, brandId: id, canonicalKey: definition.canonicalKey,
      ...definition.facts, source: "official", confidence: "HIGH", officialUrl: definition.source.url, review: null };
    const evidence = { version: 1 as const, sourceHash: definition.source.sha256, locator: definition.locator, reviewedBy: pilot.reviewedBy, aliases: definition.aliases };
    const review = { ...evidence, dataHash: chainReviewHash(row, evidence) };
    if (!approvedChainRow({ ...row, review })) throw new Error(`Invalid reviewed facts: ${definition.canonicalKey}`);
    append(before, { brandId: id, canonicalKey: row.canonicalKey, ...definition.facts, source: "official", confidence: "HIGH",
      officialUrl: row.officialUrl, aliases: before?.aliases ?? [], review: JSON.parse(JSON.stringify(review)) }, definition.expected);
  }
  for (const definition of pilot.quarantine) {
    const id = brandId(definition.slug), before = find(id, definition.canonicalKey);
    if (!before) throw new Error(`Quarantined row missing: ${definition.canonicalKey}`);
    const desired: Desired = { brandId: id, canonicalKey: before.canonicalKey, aliases: [], calories: before.calories,
      proteinG: before.proteinG, carbsG: before.carbsG, fatG: before.fatG, servingSize: before.servingSize, source: before.source,
      confidence: before.confidence, officialUrl: before.officialUrl, review: null };
    append(before, desired, definition.expected);
  }
  const replacements = new Set(changes.map(c => `${c.desired.brandId}:${c.desired.canonicalKey}`));
  const final: ChainCatalogRow[] = [...catalog.filter(r => !replacements.has(`${r.brandId}:${r.canonicalKey}`)),
    ...changes.map(c => ({ ...c.desired, id: c.before?.id ?? `${c.desired.brandId}:${c.desired.canonicalKey}` }))];
  const match = buildChainMatcher(final);
  for (const row of final) {
    const approved = approvedChainRow(row);
    if (!approved) continue;
    for (const alias of approved.review.aliases) {
      const item = { name: alias.name, ...(alias.section !== undefined ? { section: alias.section } : {}), ...(alias.description !== undefined ? { description: alias.description } : {}) };
      if (match(row.brandId, item).status !== "matched") throw new Error(`Ambiguous reviewed alias: ${alias.name}`);
    }
  }
  return { changes, hash: stateHash(changes) };
}

/** Atomic catalog apply. The caller must durably save the plan before invoking this. */
export async function applyCatalogPlan(prisma: PrismaClient, plan: CatalogPlan, pilot = chainPilot): Promise<ChainItem[]> {
  if (stateHash(plan.changes) !== plan.hash) throw new Error("Plan digest mismatch");
  return prisma.$transaction(async tx => {
    const brands = await tx.brand.findMany({ where: { slug: { in: [...new Set([...pilot.changes, ...pilot.quarantine].map(d => d.slug))] } } });
    const currentCatalog = await tx.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) } } });
    if (planChainPilot(brands, currentCatalog, pilot).hash !== plan.hash) throw new Error("Catalog or curated definition changed after planning");
    const after: ChainItem[] = [];
    for (const change of plan.changes) {
      const { desired, before } = change;
      const where = { brandId_canonicalKey: { brandId: desired.brandId, canonicalKey: desired.canonicalKey } };
      const current = await tx.chainItem.findUnique({ where });
      if (stateHash(current) !== stateHash(before)) throw new Error(`Catalog changed after planning: ${desired.canonicalKey}`);
      const data = { ...desired, review: desired.review === null ? Prisma.DbNull : reviewJson(desired.review), retrievedAt: new Date() };
      after.push(await tx.chainItem.upsert({ where, create: data, update: data }));
    }
    return after;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

/** Roll back only the exact rows we wrote; concurrent edits require a new plan. */
export async function rollbackCatalogPlan(prisma: PrismaClient, plan: CatalogPlan, after: ChainItem[]): Promise<void> {
  if (after.length !== plan.changes.length || stateHash(plan.changes) !== plan.hash) throw new Error("Incomplete catalog rollback evidence");
  await prisma.$transaction(async tx => {
    for (const [index, change] of plan.changes.entries()) {
      const written = after[index]!;
      if (stateHash({ ...facts(written), brandId: written.brandId, review: written.review }) !== stateHash(change.desired)) throw new Error("Rollback row does not match its planned change");
      const current = await tx.chainItem.findUnique({ where: { id: written.id } });
      if (stateHash(current) !== stateHash(written)) throw new Error(`Catalog changed after apply: ${written.id}`);
      if (!change.before) await tx.chainItem.delete({ where: { id: written.id } });
      else {
        const { id, ...before } = change.before;
        await tx.chainItem.update({ where: { id }, data: { ...before, review: before.review === null ? Prisma.DbNull : reviewJson(before.review) } });
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
