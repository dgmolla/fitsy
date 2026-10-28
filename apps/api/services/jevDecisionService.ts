/** Offline evaluation and the DEV-only pipeline POC. No runtime API caller. */
import { z } from 'zod';

export interface JevDecisionRequest {
  model: 'jev-latest';
  state: Record<string, unknown>;
  questions: { chain_item_match: { type: 'choice'; instructions: string; criteria: { match: string; no_match: string } } };
}
export interface JevChoiceRequest {
  model: 'jev-latest';
  state: Record<string, unknown>;
  questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }>;
}

const probability = z.number().finite().min(0).max(1);
const answerSchema = z.object({
  type: z.literal('choice'), choice: z.enum(['match', 'no_match']), confidence: probability,
  probabilities: z.object({ match: probability, no_match: probability }).strict(),
}).refine(a => Math.abs(a.probabilities.match + a.probabilities.no_match - 1) <= 0.01
  && a.probabilities[a.choice] >= a.probabilities[a.choice === 'match' ? 'no_match' : 'match'], 'Invalid choice probabilities');
const responseSchema = z.object({
  model: z.string().regex(/^jev-/),
  answers: z.object({ chain_item_match: answerSchema }).strict(),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

/** Parse only after retaining the raw HTTP body, including invalid/provider-error responses. */
export function parseJevDecision(body: string) {
  return responseSchema.parse(JSON.parse(body));
}

/** One bounded request, no hidden retries, redirects, logging or credential-file discovery. */
export async function requestJevDecision(request: JevChoiceRequest, apiKey: string, signal?: AbortSignal) {
  if (!apiKey.trim()) throw new Error('TYPESAFE_API_KEY is required');
  if (Buffer.byteLength(JSON.stringify(request)) > 12_000) throw new Error('Jev evaluation request exceeds 12KB');
  signal?.throwIfAborted();
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return { status: response.status, body: await response.text() };
}
