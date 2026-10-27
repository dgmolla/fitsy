import { z } from 'zod';
import type { FailureKind } from './failures';

const text = z.string().min(1);
const quantity = z.number().finite().nonnegative();
export const macrosSchema = z.object({ calories: quantity, protein: quantity, carbs: quantity, fat: quantity }).strict();
export type Macros = z.infer<typeof macrosSchema>;
export const macroNames = ['calories', 'protein', 'carbs', 'fat'] as const;
export const itemSchema = z.object({ chain: text, name: text, section: z.string(), description: z.string(),
  serving: z.string(), region: z.string() }).strict();
export type Item = z.infer<typeof itemSchema>;
export const sourceSchema = z.object({ url: z.url(), page: z.union([z.number().int().positive(), text]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), locator: text }).strict();
export const rowTagSchema = z.enum(['dish', 'component', 'catering', 'regional', 'size-variant', 'other', 'gluten-sensitive']);
export const rowSchema = z.object({ id: text, chain: text, name: text, section: z.string(), serving: text,
  region: z.string(), tags: z.array(rowTagSchema).min(1).optional(), macros: macrosSchema, source: sourceSchema }).strict();
export type Row = z.infer<typeof rowSchema>;
export type Candidate = Omit<Row, 'macros' | 'source'>;
export function candidate(row: Row): Candidate {
  const { id, chain, name, section, serving, region, tags } = row;
  return { id, chain, name, section, serving, region, ...(tags ? { tags: [...tags] } : {}) };
}
const base = { id: text, tier: z.enum(['curated', 'bulk']), split: z.enum(['dev', 'holdout']),
  group: text, category: text, chain: text, why: text, source: sourceSchema,
  origin: z.enum(['captured-uber-eats', 'published-row', 'synthetic-challenge']), input: itemSchema,
  capture: z.object({ itemId: text, url: z.url(), sha256: text, line: z.number().int().positive(),
    missCategory: text }).strict().optional() };
export const matchCaseSchema = z.object({ ...base, task: z.literal('matching'), candidates: z.array(text).min(1),
  expected: z.object({ kind: z.enum(['match', 'none']), matchId: text.nullable() }).strict() }).strict();
export const macroCaseSchema = z.object({ ...base, task: z.literal('macro'), expected: macrosSchema }).strict();
export const caseSchema = z.discriminatedUnion('task', [matchCaseSchema, macroCaseSchema]);
export type Case = z.infer<typeof caseSchema>;
export type MatchCase = z.infer<typeof matchCaseSchema>;
export type MacroCase = z.infer<typeof macroCaseSchema>;
export type Split = Case['split'];
export type Tier = Case['tier'];
export interface MatchOutput { kind: 'match' | 'none' | 'abstain'; matchId: string | null; confidence: number }
export interface Matcher { name: string; match(item: Item, rows: Candidate[]): Promise<MatchOutput> }
export interface Estimator { name: string; estimate(item: Item): Promise<Macros | null> }
export interface Method { name: string; matcher?: Matcher; estimator?: Estimator }
export interface Result { id: string; method: string; output: MatchOutput | Macros | null;
  failure: string | null; failureKind?: FailureKind | null; latencyMs: number; costUsd: number | null; knownCostUsd?: number; requests: number; reusedRequests?: number }
