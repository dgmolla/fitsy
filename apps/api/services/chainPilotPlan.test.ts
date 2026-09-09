import { PrismaClient, type Brand, type ChainItem } from "@prisma/client";
import { chainPilot } from "./chainPilotData";
import { planChainPilot, stateHash, applyCatalogPlan, rollbackCatalogPlan } from "./chainPilotPlan";
const now = new Date("2026-09-08T00:00:00Z");
const brands: Brand[] = ["waba-grill", "yoshinoya"].map(slug => ({ id: slug, slug, displayName: slug, aliases: [], locationCount: 1, menuKind: "restaurant", bestPair: null, distinctive: true, detectionConf: "high", macroSource: null, officialUrl: null, createdAt: now, updatedAt: now }));
const catalog: ChainItem[] = [...chainPilot.changes, ...chainPilot.quarantine].flatMap(d => d.expected ? [{ ...d.expected, id: d.slug + d.canonicalKey, brandId: d.slug, review: null, retrievedAt: now, createdAt: now, updatedAt: now }] : []);
test("backup digests survive JSON dates and object-key order, but detect changed facts and array order", () => {
  expect(stateHash({ date: now, a: [1, 2] })).toBe(stateHash({ a: [1, 2], date: now.toISOString() }));
  expect(stateHash([1, 2])).not.toBe(stateHash([2, 1]));
  expect(stateHash({ calories: 820 })).not.toBe(stateHash({ calories: 821 }));
});
test("audited baseline produces seven approved facts and five quarantines, then replans to zero", () => {
  const plan = planChainPilot(brands, catalog);
  expect(plan.changes).toHaveLength(12);
  const replacementIds = new Set(plan.changes.map(c => c.before?.id));
  const after: ChainItem[] = [...catalog.filter(r => !replacementIds.has(r.id)), ...plan.changes.map(c => ({ id: c.before?.id ?? c.desired.canonicalKey, retrievedAt: now, createdAt: now, updatedAt: now, ...c.desired }))];
  expect(after.filter(r => r.review)).toHaveLength(7);
  expect(planChainPilot(brands, after).changes).toEqual([]);
  expect(() => planChainPilot(brands, after.map(r => r.review ? { ...r, servingSize: "Changed portion" } : r))).toThrow("baseline");
});
test("unknown brand and source states fail closed before writing a plan", () => {
  expect(() => planChainPilot([], catalog)).toThrow("Verified brand");
  expect(() => planChainPilot(brands.map(b => ({ ...b, detectionConf: "medium" })), catalog)).toThrow("Verified brand");
  expect(() => planChainPilot(brands, catalog.map((r, i) => i ? r : { ...r, calories: 1 }))).toThrow("baseline");
  expect(() => planChainPilot(brands, catalog.filter(r => r.canonicalKey !== "shrimp"))).toThrow("Quarantined row missing");
});
test("altered or incomplete backups reject before opening a database transaction", async () => {
  const p = new PrismaClient(), plan = planChainPilot(brands, catalog);
  try {
    await expect(applyCatalogPlan(p, { ...plan, hash: "altered" })).rejects.toThrow("digest");
    await expect(rollbackCatalogPlan(p, plan, [])).rejects.toThrow("Incomplete");
  } finally { await p.$disconnect(); }
});
