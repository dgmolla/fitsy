import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Brand } from "@prisma/client";
import { planChainIdentity, type ChainIdentityBatch, type RestaurantIdentity } from "./chainIdentityPlan";
import { buildBrandIdentityMatcher } from "./chainServing";

const now = new Date("2026-09-11"), identity = { id: "cafe", slug: "cafe", displayName: "Fixture Cafe", aliases: [], detectionConf: "high", menuKind: "restaurant" };
const brand: Brand = { ...identity, locationCount: 1, bestPair: null, distinctive: true, macroSource: null, officialUrl: null, createdAt: now, updatedAt: now };
const restaurant: RestaurantIdentity = { id: "store", name: "Fixture Cafe #42", storeUuid: "ue-store", brandId: "cafe", chainFlag: false, menuKind: "restaurant" };
const batch = (): ChainIdentityBatch => ({ version: 1, reviewedBy: "Synthetic guard test", brands: [{ id: identity.id, slug: identity.slug, displayName: identity.displayName,
  expected: { ...identity, aliases: [] }, addAliases: [restaurant.name],
  evidence: { url: "https://example.com/fixture", sha256: "0".repeat(64), locator: "Synthetic identity" } }], links: [{ brandId: "cafe", expected: restaurant }] });

test.each(["low", "retail", "rename", "brand-owner", "outside-batch", "duplicate-id", "duplicate-slug", "duplicate-link", "slug-owner"])("reviewed onboarding rejects %s", scenario => {
  const b = batch(), brands = [structuredClone(brand)], restaurants = [structuredClone(restaurant)];
  let message = "";
  switch (scenario) {
    case "low": b.brands[0]!.expected!.detectionConf = "low"; message = "Unqualified brand identity"; break;
    case "retail": b.brands[0]!.expected!.menuKind = "retail"; message = "Unqualified brand identity"; break;
    case "rename": b.brands[0]!.displayName = "Renamed Cafe"; message = "Existing brand identity cannot be renamed"; break;
    case "brand-owner": restaurants[0]!.brandId = "other"; message = "Restaurant does not have the reviewed unique identity"; break;
    case "outside-batch": b.links[0]!.brandId = "other"; message = "Unreviewed restaurant would change identity"; break;
    case "duplicate-id": b.brands.push({ ...b.brands[0]!, slug: "different" }); message = "Duplicate brand ID"; break;
    case "duplicate-slug": b.brands.push({ ...b.brands[0]!, id: "different" }); message = "Duplicate brand slug"; break;
    case "duplicate-link": b.links.push(b.links[0]!); message = "Duplicate restaurant link"; break;
    case "slug-owner": brands.push({ ...brand, id: "other" }); message = "Brand slug already has another identity"; break;
  }
  expect(() => planChainIdentity(brands, restaurants, b)).toThrow(message);
});

test("unrelated brand activity leaves a plan stable, but a newly colliding claim rejects", () => {
  const b = batch(), before = planChainIdentity([brand], [restaurant], b);
  const other = { ...brand, id: "other", slug: "other", displayName: "Other Cafe" };
  expect(planChainIdentity([brand, other], [restaurant], b).hash).toBe(before.hash);
  expect(() => planChainIdentity([brand, { ...other, aliases: [restaurant.name] }], [restaurant], b)).toThrow("collides");
  expect(() => planChainIdentity([{ ...brand, aliases: ["Changed"] }], [restaurant], b)).toThrow("Brand differs from reviewed baseline");
  const outside = { ...b, links: [{ brandId: "other", expected: { ...restaurant, name: "unrelated", brandId: null } }] };
  expect(() => planChainIdentity([brand], [{ ...restaurant, name: "unrelated", brandId: null }], outside)).toThrow("Link refers to a brand outside the reviewed batch");
});

test("indexed brand resolver retains unique exact aliases and rejects ambiguous or conflicting identities", () => {
  const resolveIdentity = buildBrandIdentityMatcher([{ ...brand, aliases: ["Fixture Cafe", "Fixture Cafe #42", "Shared Cafe"] },
    { ...brand, id: "other", slug: "other", displayName: "Other Cafe", aliases: ["Shared Cafe"] }]);
  expect(resolveIdentity({ name: "Ｆｉｘｔｕｒｅ Cafe #42 (Downtown)" })).toBe("cafe");
  expect(resolveIdentity({ name: "Fixture Cafe - Downtown" })).toBe("cafe");
  expect(resolveIdentity({ name: "Shared Cafe" })).toBeUndefined();
  expect(resolveIdentity({ name: "Fixture Cafe Express" })).toBeUndefined();
  expect(resolveIdentity({ name: "Fixture Cafe", brandId: "other" })).toBeUndefined();
  expect(buildBrandIdentityMatcher([{ ...brand, detectionConf: "low" }])({ name: "Fixture Cafe" })).toBeUndefined();
});

test("malformed CLI database configuration does not echo its secret", () => {
  const marker = "synthetic-secret-must-not-appear", root = resolve(__dirname, "../../..");
  try {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/preload-chain-identity.ts", "plan", "unused", "unused"], {
      cwd: root, env: { ...process.env, POSTGRES_URL_NON_POOLING: `not-a-database-url-${marker}` }, stdio: "pipe" });
    throw new Error("Expected invalid URL rejection");
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    expect(stderr).toContain("Invalid database URL");
    expect(stderr).not.toContain(marker);
    expect(stderr).not.toContain("ERR_INVALID_URL");
  }
});
