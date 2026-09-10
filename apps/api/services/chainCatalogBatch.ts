import { z } from "zod";
import { chainReviewSchema } from "./chainCatalog";

const text = z.string().trim().min(1);
const number = z.number().finite().nonnegative();
const facts = z.object({ calories: number.int(), proteinG: number, carbsG: number, fatG: number, servingSize: text }).strict();
const baseline = z.object({ canonicalKey: text, aliases: z.array(z.string()), calories: number.nullable(),
  proteinG: number.nullable(), carbsG: number.nullable(), fatG: number.nullable(), servingSize: z.string().nullable(),
  source: z.string(), confidence: z.string(), officialUrl: z.string().nullable(), review: chainReviewSchema.nullable().optional() }).strict();
const identity = { slug: text, canonicalKey: text };
/** Offline audited input. Parsing validates structure; source inspection remains an onboarding step. */
export const chainCatalogBatchSchema = z.object({ version: z.literal(1), reviewedBy: text,
  changes: z.array(z.object({ ...identity, expected: baseline.nullable(), facts,
    source: z.object({ url: z.string().url().startsWith("https://"), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    locator: text, aliases: chainReviewSchema.shape.aliases }).strict()),
  quarantine: z.array(z.object({ ...identity, expected: baseline }).strict()),
}).strict().superRefine((batch, ctx) => {
  const seen = new Set<string>();
  for (const row of [...batch.changes, ...batch.quarantine]) {
    const key = JSON.stringify([row.slug, row.canonicalKey]);
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate catalog key: ${key}` });
    if (row.expected && row.expected.canonicalKey !== row.canonicalKey) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Baseline key mismatch: ${key}` });
    seen.add(key);
  }
  if (!seen.size) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Empty catalog batch" });
});
export type ChainCatalogBatch = z.infer<typeof chainCatalogBatchSchema>;
