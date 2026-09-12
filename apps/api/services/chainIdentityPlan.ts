import { z } from "zod";
import type { Brand, Prisma, PrismaClient } from "@prisma/client";
import { stateHash } from "./chainPilotPlan";
import { brandName, buildBrandIdentityMatcher } from "./chainServing";
import { chainTransaction } from "./chainTransaction";

const text = z.string().trim().min(1);
const identity = z.object({ id: text, slug: text, displayName: text, aliases: z.array(text),
  detectionConf: z.string().nullable(), menuKind: text }).strict();
const restaurant = z.object({ id: text, name: text, storeUuid: z.string().nullable(), brandId: z.string().nullable(),
  chainFlag: z.boolean(), menuKind: text }).strict();
export const chainIdentityBatchSchema = z.object({ version: z.literal(1), reviewedBy: text,
  brands: z.array(z.object({ id: text, slug: text, displayName: text, addAliases: z.array(text), expected: identity.nullable(),
    evidence: z.object({ url: z.string().url().startsWith("https://"), sha256: z.string().regex(/^[a-f0-9]{64}$/), locator: text }).strict(),
  }).strict()).min(1),
  links: z.array(z.object({ brandId: text, expected: restaurant }).strict()),
}).strict();
export type ChainIdentityBatch = z.infer<typeof chainIdentityBatchSchema>;
export type RestaurantIdentity = z.infer<typeof restaurant>;
const brandIdentity = (b: Brand) => identity.parse(Object.fromEntries(Object.keys(identity.shape).map(k => [k, b[k as keyof Brand]])));
export const restaurantIdentitySelect = { id: true, name: true, storeUuid: true, brandId: true, chainFlag: true, menuKind: true } as const;
interface BrandChange { before: Brand | null; desired: z.infer<typeof identity>; officialUrl: string }
interface LinkChange { before: RestaurantIdentity; desired: RestaurantIdentity }
export interface ChainIdentityPlan { batch: ChainIdentityBatch; brandStateHash: string; brands: BrandChange[]; links: LinkChange[]; hash: string }
const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`); };

/** No fuzzy identity inference: a reviewed alias must resolve uniquely through the production guard. */
export function planChainIdentity(brands: Brand[], restaurants: RestaurantIdentity[], input: unknown): ChainIdentityPlan {
  const batch = chainIdentityBatchSchema.parse(input), changes: BrandChange[] = [], links: LinkChange[] = [];
  unique(batch.brands.map(b => b.id), "brand ID"); unique(batch.brands.map(b => b.slug), "brand slug");
  unique(batch.links.map(l => l.expected.id), "restaurant link");
  const final = brands.map(brandIdentity), selectedIds = new Set(batch.brands.map(b => b.id));
  // Replanning still checks every current claim and restaurant. Unrelated brands
  // must not invalidate a plan merely because their independent state changed.
  const brandStateHash = stateHash(final.filter(b => selectedIds.has(b.id)).sort((a, b) => a.id.localeCompare(b.id)));
  for (const definition of batch.brands) {
    const before = brands.find(b => b.id === definition.id) ?? null;
    if (brands.some(b => b.slug === definition.slug && b.id !== definition.id)) throw new Error("Brand slug already has another identity");
    if (definition.expected && (definition.expected.id !== definition.id || definition.expected.slug !== definition.slug
      || definition.expected.displayName !== definition.displayName)) throw new Error("Existing brand identity cannot be renamed");
    const desired = { id: definition.id, slug: definition.slug, displayName: definition.displayName,
      aliases: [...new Set([...(definition.expected?.aliases ?? []), ...definition.addAliases])],
      detectionConf: definition.expected ? definition.expected.detectionConf : "high", menuKind: definition.expected?.menuKind ?? "restaurant" };
    if (desired.menuKind !== "restaurant" || !["high", "llm-confirmed"].includes(desired.detectionConf ?? "")) throw new Error("Unqualified brand identity");
    const current = before ? brandIdentity(before) : null;
    if (stateHash(current) !== stateHash(desired)) {
      if (stateHash(current) !== stateHash(definition.expected)) throw new Error("Brand differs from reviewed baseline");
      changes.push({ before, desired, officialUrl: definition.evidence.url });
    }
    const index = final.findIndex(b => b.id === definition.id);
    if (index < 0) final.push(desired); else final[index] = desired;
  }
  // Explicit identity claims may not introduce ambiguity, including at future locations.
  const claims = new Map<string, Set<string>>();
  for (const b of final.filter(b => b.menuKind === "restaurant" && ["high", "llm-confirmed"].includes(b.detectionConf ?? ""))) {
    for (const name of [b.displayName, b.slug, ...b.aliases]) {
      const normalized = brandName(name);
      const ids = claims.get(normalized) ?? new Set<string>(); ids.add(b.id); claims.set(normalized, ids);
    }
  }
  for (const change of changes) for (const name of [change.desired.displayName, change.desired.slug, ...change.desired.aliases]) {
    const normalized = brandName(name);
    if (claims.get(normalized)!.size > 1) throw new Error("Reviewed brand alias collides with another brand");
  }
  const allowed = new Map(batch.links.map(l => [l.expected.id, l]));
  const beforeIdentity = buildBrandIdentityMatcher(brands), afterIdentity = buildBrandIdentityMatcher(final);
  for (const r of restaurants) {
    const before = beforeIdentity(r), after = afterIdentity(r);
    if (before !== after && (!allowed.has(r.id) || allowed.get(r.id)!.brandId !== after)) throw new Error(`Unreviewed restaurant would change identity: ${r.id}`);
  }
  for (const link of batch.links) {
    if (!batch.brands.some(b => b.id === link.brandId)) throw new Error("Link refers to a brand outside the reviewed batch");
    const before = restaurants.find(r => r.id === link.expected.id);
    if (!before || before.menuKind !== "restaurant" || (before.brandId && before.brandId !== link.brandId)
      || afterIdentity(before) !== link.brandId) throw new Error("Restaurant does not have the reviewed unique identity");
    const desired = { ...link.expected, brandId: link.brandId, chainFlag: true };
    if (stateHash(before) === stateHash(desired)) continue;
    if (stateHash(before) !== stateHash(link.expected)) throw new Error("Restaurant differs from reviewed baseline");
    links.push({ before, desired });
  }
  const plan = { batch, brandStateHash, brands: changes, links };
  return { ...plan, hash: stateHash(plan) };
}
export async function readChainIdentities(p: Pick<PrismaClient | Prisma.TransactionClient, "brand" | "restaurant">) {
  return { brands: await p.brand.findMany({ orderBy: { id: "asc" } }),
    restaurants: await p.restaurant.findMany({ select: restaurantIdentitySelect, orderBy: { id: "asc" } }) };
}
export interface ChainIdentityJournal { plan: ChainIdentityPlan; brands: Brand[]; restaurants: RestaurantIdentity[] }
/** Caller saves the plan durably before this all-or-nothing transaction. */
export async function applyChainIdentity(prisma: PrismaClient, plan: ChainIdentityPlan): Promise<ChainIdentityJournal> {
  const { hash, ...content } = plan;
  if (stateHash(content) !== hash) throw new Error("Identity plan digest mismatch");
  return chainTransaction(prisma, async tx => {
    const current = await readChainIdentities(tx);
    if (planChainIdentity(current.brands, current.restaurants, plan.batch).hash !== hash) throw new Error("Identity plan changed; replan");
    const brands: Brand[] = [], restaurants: RestaurantIdentity[] = [];
    for (const change of plan.brands) brands.push(change.before
      ? await tx.brand.update({ where: { id: change.before.id }, data: { aliases: change.desired.aliases } })
      : await tx.brand.create({ data: { ...change.desired, officialUrl: change.officialUrl,
        locationCount: plan.batch.links.filter(l => l.brandId === change.desired.id).length } }));
    for (const link of plan.links) restaurants.push(await tx.restaurant.update({ where: { id: link.before.id },
      data: { brandId: link.desired.brandId, chainFlag: true }, select: restaurantIdentitySelect }));
    return { plan, brands, restaurants };
  }, 120_000);
}

/** Catalog/April rollback comes first; a newly imported location blocks deletion of its brand. */
export async function rollbackChainIdentity(prisma: PrismaClient, journal: ChainIdentityJournal): Promise<void> {
  const { plan, brands, restaurants } = journal, { hash, ...content } = plan;
  if (stateHash(content) !== hash || brands.length !== plan.brands.length || restaurants.length !== plan.links.length) throw new Error("Incomplete identity rollback evidence");
  await chainTransaction(prisma, async tx => {
    for (const [i, change] of plan.brands.entries()) {
      const after = brands[i]!;
      if (stateHash(brandIdentity(after)) !== stateHash(change.desired)
        || stateHash(await tx.brand.findUnique({ where: { id: after.id } })) !== stateHash(after)) throw new Error("Brand changed after identity apply");
    }
    for (const [i, link] of plan.links.entries()) {
      const after = restaurants[i]!;
      if (stateHash(after) !== stateHash(link.desired) || stateHash(await tx.restaurant.findUnique({
        where: { id: after.id }, select: restaurantIdentitySelect })) !== stateHash(after)) throw new Error("Restaurant changed after identity apply");
    }
    for (const link of plan.links) await tx.restaurant.update({ where: { id: link.before.id },
      data: { brandId: link.before.brandId, chainFlag: link.before.chainFlag } });
    for (const change of plan.brands) {
      if (change.before) await tx.brand.update({ where: { id: change.before.id }, data: { aliases: change.before.aliases } });
      else {
        const id = change.desired.id;
        if (await tx.chainItem.count({ where: { brandId: id } }) || await tx.restaurant.count({ where: { brandId: id } })) throw new Error("New brand still has catalog or restaurant references; roll those back first");
        await tx.brand.delete({ where: { id } });
      }
    }
  }, 120_000);
}
