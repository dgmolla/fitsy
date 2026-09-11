import { z } from "zod";
import { chainCatalogBatchSchema, type ChainCatalogBatch } from "./chainCatalogBatch";

const change = chainCatalogBatchSchema.shape.changes.element;
const text = z.string().trim().min(1);
/** One reviewed manufacturer serving may feed several chains; bindings still require exact menu context. */
export const chainProductInputSchema = z.object({
  version: z.literal(1), reviewedBy: text,
  products: z.array(z.object({ key: text, market: z.literal("US"), name: text,
    facts: change.shape.facts, source: change.shape.source, locator: text }).strict()),
  bindings: z.array(z.object({ productKey: text, slug: text, canonicalKey: text,
    expected: change.shape.expected, aliases: change.shape.aliases.min(1) }).strict()),
  changes: chainCatalogBatchSchema.shape.changes,
  quarantine: chainCatalogBatchSchema.shape.quarantine,
}).strict();
export function compileChainProductBatch(input: unknown): ChainCatalogBatch {
  const parsed = chainProductInputSchema.parse(input), products = new Map(parsed.products.map(p => [p.key, p]));
  if (products.size !== parsed.products.length) throw new Error("Duplicate manufacturer product key");
  const additions = parsed.bindings.map(({ productKey, ...binding }) => {
    const product = products.get(productKey);
    if (!product) throw new Error(`Unknown manufacturer product: ${productKey}`);
    return { ...binding, facts: product.facts, source: product.source,
      locator: `${product.market} product ${product.key} (${product.name}); ${product.locator}` };
  });
  return chainCatalogBatchSchema.parse({ version: parsed.version, reviewedBy: parsed.reviewedBy,
    changes: [...parsed.changes, ...additions], quarantine: parsed.quarantine });
}
