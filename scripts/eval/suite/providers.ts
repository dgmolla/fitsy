import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { JEV_LIMITS, parseChoiceAnswers, type JevRequest } from '../lib/jev-experiment';
import { spendState, type ChoiceClient } from './budget';
import { durableAppend } from './fixtures';
import { requestKey, type PaidResponse } from './replay';

export type Provider = 'haiku' | 'qwen';
export const MODEL_STOP_USD = 2.70;
export const MODEL_HARD_CAP_USD = 3;
export const MAX_OUTPUT_TOKENS = 1536;
export const providers = {
  haiku: { model: 'claude-haiku-4-5', requiredModel: 'claude-haiku-4-5-20251001',
    key: 'ANTHROPIC_API_KEY', endpoint: 'https://api.anthropic.com/v1/messages', input: 1, output: 5,
    pricingSource: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  qwen: { model: 'qwen/qwen3-235b-a22b-2507', requiredModel: 'qwen/qwen3-235b-a22b-2507',
    key: 'OPENROUTER_API_KEY', endpoint: 'https://openrouter.ai/api/v1/chat/completions', input: 0.09, output: 0.55,
    pricingSource: 'https://openrouter.ai/api/v1/models' },
} as const;

/** Same typed answers and probabilities as Jev, without model-specific task instructions. */
export function answerSchema(request: JevRequest) {
  const object = (properties: Record<string, unknown>) => ({ type: 'object', properties,
    required: Object.keys(properties), additionalProperties: false });
  return object({ answers: object(Object.fromEntries(Object.entries(request.questions).map(([name, question]) => [name,
    object({ type: { type: 'string', enum: ['choice'] }, choice: { type: 'string', enum: Object.keys(question.criteria) },
      confidence: { type: 'number' }, probabilities: object(Object.fromEntries(Object.keys(question.criteria)
        .map(key => [key, { type: 'number' }]))) })]))) });
}
export function providerRequest(provider: Provider, request: JevRequest) {
  if (Buffer.byteLength(JSON.stringify(request)) > JEV_LIMITS.maxRequestBytes) throw new Error('Request exceeds shared 12KB envelope');
  const schema = answerSchema(request), messages = [{ role: 'user', content: JSON.stringify({ state: request.state, questions: request.questions }) }];
  const common = { model: providers[provider].model, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS, messages };
  return provider === 'haiku' ? { ...common, output_config: { format: { type: 'json_schema', schema } } }
    : { ...common, response_format: { type: 'json_schema', json_schema: { name: 'choice_answers', strict: true, schema } },
      usage: { include: true }, provider: { allow_fallbacks: false, require_parameters: true,
        max_price: { prompt: providers.qwen.input, completion: providers.qwen.output } } };
}
export function reservation(provider: Provider, request: JevRequest) {
  // One token per UTF-8 byte plus 1,024 tokens of framing/schema overhead is deliberately conservative.
  const inputTokens = Buffer.byteLength(JSON.stringify(providerRequest(provider, request))) + 1024;
  return { inputTokens, usd: (inputTokens * providers[provider].input + MAX_OUTPUT_TOKENS * providers[provider].output) / 1e6 };
}
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({ input_tokens: count, output_tokens: count,
  cache_creation_input_tokens: count.optional(), cache_read_input_tokens: count.optional() });

/** Owns the existing ledger lock for both paid adapters; prior model spending also consumes this allowance. */
export class ModelSession {
  readonly ledger: string;
  readonly lock: string;
  knownUsd: number;
  modelKnownUsd: number;
  stopped: string | null = null;
  unknown = false;
  private closed = false;
  private pending = new Map<string, number>();
  constructor(readonly runId: string, directory: string) {
    mkdirSync(directory, { recursive: true });
    this.ledger = join(directory, 'spend.jsonl'); this.lock = join(directory, '.jev.lock');
    const fd = openSync(this.lock, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() }) + '\n'); }
    finally { closeSync(fd); }
    try {
      const state = spendState(this.ledger);
      this.knownUsd = state.knownUsd; this.modelKnownUsd = state.modelKnownUsd;
      if (state.unknown) throw new Error('Unknown prior provider usage; reconcile billing before collection');
      if (this.modelKnownUsd >= MODEL_STOP_USD) throw new Error('Haiku/Qwen $2.70 stop threshold reached');
    } catch (error) { unlinkSync(this.lock); throw error; }
  }
  get remainingUsd() { return Math.max(0, MODEL_STOP_USD - this.modelKnownUsd); }
  stop(message: string): never { this.stopped ??= message; throw new Error(this.stopped); }
  record(file: string, value: unknown) {
    try { durableAppend(file, value); }
    catch { this.unknown = true; this.stop('Journal write failed; reconcile reserved provider usage before collection'); }
  }
  reserve(provider: Provider, reserveUsd: number) {
    if (this.closed || this.stopped) throw new Error('Provider session stopped');
    if (reserveUsd + [...this.pending.values()].reduce((n, usd) => n + usd, 0) > this.remainingUsd) return this.stop('Haiku/Qwen $2.70 stop threshold reached before request');
    const receipt = { provider, requestId: randomUUID(), runId: this.runId, at: new Date().toISOString() };
    this.record(this.ledger, { ...receipt, event: 'reserve', reserveUsd });
    this.pending.set(receipt.requestId, reserveUsd);
    return receipt;
  }
  settle(receipt: ReturnType<ModelSession['reserve']>, costUsd: number | null, failure: string | null) {
    this.knownUsd += costUsd ?? 0; this.modelKnownUsd += costUsd ?? 0; this.unknown ||= costUsd === null;
    this.record(this.ledger, { ...receipt, event: 'settle', costUsd, failure });
    this.pending.delete(receipt.requestId);
  }
  close() { if (!this.closed) { this.closed = true; unlinkSync(this.lock); } }
}
export class ModelClient implements ChoiceClient {
  knownUsd = 0;
  requests = 0;
  reusedRequests = 0;
  context = '';
  private replay = new Map<string, PaidResponse>();
  readonly rawFile: string;
  constructor(readonly provider: Provider, private session: ModelSession, runDirectory: string,
    private apiKey: string, private transport: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error(`${providers[provider].key} is missing; no requests were sent`);
    this.rawFile = join(runDirectory, `${provider}-exchanges.jsonl`);
  }
  get stopped() { return this.session.stopped; }
  get unknown() { return this.session.unknown; }
  async send(request: JevRequest) {
    if (this.stopped) throw new Error('Provider session stopped');
    const key = requestKey(request), cached = this.replay.get(key);
    if (cached) {
      this.session.record(this.rawFile, { event: 'reuse', runId: this.session.runId, context: this.context,
        requestSha256: key, sourceRunId: cached.runId, sourceRequestId: cached.requestId,
        originalLatencyMs: cached.latencyMs, costUsd: 0, at: new Date().toISOString() });
      this.reusedRequests++;
      return { raw: structuredClone(cached.raw), costUsd: 0, latencyMs: cached.latencyMs };
    }
    const config = providers[this.provider], payload = providerRequest(this.provider, request), bound = reservation(this.provider, request);
    const receipt = this.session.reserve(this.provider, bound.usd);
    this.session.record(this.rawFile, { ...receipt, event: 'request', context: this.context, request, payload, bound });
    const started = performance.now(); this.requests++;
    let status = 0, body = '', failure: string | null = null, costUsd: number | null = null, raw: unknown;
    try {
      const response = await this.transport(config.endpoint, { method: 'POST', redirect: 'error',
        headers: this.provider === 'haiku' ? { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
          : { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
      status = response.status; body = await response.text();
      if (body.includes(this.apiKey)) { body = body.replaceAll(this.apiKey, '[REDACTED]'); failure = 'Credential echo redacted'; }
      const data = JSON.parse(body);
      let inputTokens: number, outputTokens: number, text: string;
      if (this.provider === 'haiku') {
        const usage = usageSchema.parse(data.usage);
        inputTokens = usage.input_tokens; outputTokens = usage.output_tokens;
        // No cache controls are sent. Retain exact standard/cache-read/cache-write billing if returned.
        costUsd = (inputTokens + (usage.cache_read_input_tokens ?? 0) * 0.1
          + (usage.cache_creation_input_tokens ?? 0) * 1.25 + outputTokens * config.output) / 1e6;
        inputTokens += (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        text = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(data.content).map(c => c.text).join('');
        if (data.stop_reason !== 'end_turn') failure ??= 'Incomplete provider output';
      } else {
        const usage = z.object({ prompt_tokens: count, completion_tokens: count, cost: z.number().finite().nonnegative() }).parse(data.usage);
        inputTokens = usage.prompt_tokens; outputTokens = usage.completion_tokens; costUsd = usage.cost;
        const choices = z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() })).length(1).parse(data.choices);
        text = choices[0]!.message.content;
        if (choices[0]!.finish_reason !== 'stop') failure ??= 'Incomplete provider output';
      }
      if (status !== 200) failure ??= `HTTP ${status}`;
      if (data.model !== config.requiredModel && !(this.provider === 'haiku' && data.model === config.model)) failure ??= 'Unexpected provider model identity';
      if (inputTokens > bound.inputTokens || outputTokens > MAX_OUTPUT_TOKENS || costUsd > bound.usd) failure ??= 'Provider exceeded reserved token/cost envelope';
      raw = JSON.parse(text);
      try { parseChoiceAnswers(request, raw); } catch { failure ??= 'Invalid typed answer/probability distribution'; }
    } catch { failure ??= costUsd === null ? 'Transport/response failure; unknown usage' : 'Invalid provider output'; }
    const latencyMs = performance.now() - started;
    this.knownUsd += costUsd ?? 0;
    // Settle even if response journaling fails, so a known bill is never lost from the ledger.
    try { this.session.record(this.rawFile, { ...receipt, event: 'response', context: this.context, status, body, failure, latencyMs, costUsd }); }
    finally { this.session.settle(receipt, costUsd, failure); }
    if (failure) return this.session.stop(failure);
    this.replay.set(key, { ...receipt, raw, latencyMs });
    return { raw, costUsd: costUsd!, latencyMs };
  }
  close() { this.apiKey = ''; }
}
