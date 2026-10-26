import { z } from 'zod';
import { BINNING, decodeMacroAnswers, macroAnswersSchema, macroQuestions } from './bins';
import type { ItemResult } from './score';
import { macroState } from './state';
import { sha256, type TruthRow } from './truth';

// Endpoint, model, auth, timeout and usage conventions mirror jevDecisionService.ts.
// Kept here because macro estimation needs four distributions with a frozen binning protocol.
export const PROTOCOL = {
  version: 2, endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' as const,
  timeoutMs: 5_000, retries: 0, maxSpendUsd: 1.00, maxRequestBytes: 12_000, reservedInputTokens: 16_384,
  pricing: { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0,
    source: 'docs/engineering/pipeline/jev-chain-match-eval.md', checkedAt: '2026-10-24' },
  binning: BINNING,
  questions: macroQuestions,
  catastrophicDefinition: 'calorie absolute percentage error > 50; failures and omissions are misses',
  failureMedian: 'positive infinity; non-finite median serialized as null',
  percentile: 'nearest rank',
};
export const protocolSha256 = sha256(JSON.stringify(PROTOCOL));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({ input_tokens: count.positive(), output_tokens: count });
const responseSchema = z.object({ model: z.string().regex(/^jev-/),
  answers: macroAnswersSchema });

/** This explicit projection is the ONLY item-dependent input to the provider. */
export function buildMacroRequest(item: TruthRow) {
  const request = { model: PROTOCOL.model, questions: PROTOCOL.questions, state: macroState(item) };
  if (Buffer.byteLength(JSON.stringify(request)) > PROTOCOL.maxRequestBytes) throw new Error('Jev macro request exceeds 12KB');
  return request;
}

export function canAffordRequest(spentUsd: number) {
  const reservation = PROTOCOL.reservedInputTokens * PROTOCOL.pricing.inputUsdPerMillion / 1_000_000;
  return Number.isFinite(spentUsd) && spentUsd >= 0 && spentUsd + reservation <= PROTOCOL.maxSpendUsd;
}

export function parseResponse(id: string, status: number, body: string, latencyMs: number): ItemResult {
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return { id, estimate: null, argmaxBins: null, failure: 'Malformed JSON; unknown usage', costUsd: null, latencyMs, model: null }; }
  const usage = z.object({ usage: usageSchema }).safeParse(raw);
  const costUsd = usage.success ? usage.data.usage.input_tokens * PROTOCOL.pricing.inputUsdPerMillion / 1_000_000 : null;
  const parsed = responseSchema.safeParse(raw);
  let failure = costUsd === null ? 'Missing or invalid usage'
    : usage.success && usage.data.usage.input_tokens > PROTOCOL.reservedInputTokens ? 'Reported usage exceeds reserved input envelope'
      : status !== 200 ? `HTTP ${status}` : !parsed.success ? 'Invalid typed macro response' : null;
  if (!Number.isFinite(costUsd ?? 0)) failure = 'Non-finite reported cost';
  const decoded = failure || !parsed.success ? { estimate: null, argmaxBins: null } : decodeMacroAnswers(parsed.data.answers);
  return { id, ...decoded, failure, costUsd, latencyMs, model: parsed.success ? parsed.data.model : null };
}
