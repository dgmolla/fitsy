import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { JEV_LIMITS, parseChoiceAnswers, type JevRequest } from '../lib/jev-experiment';
import { spendState, preInferenceRejection, type ChoiceClient } from './budget';
import { durableAppend } from './fixtures';
import { requestKey, type PaidResponse } from './replay';

export type Provider = 'haiku' | 'qwen';
export const MODEL_STOP_USD = 2.70;
export const MODEL_HARD_CAP_USD = 3;
export const MAX_OUTPUT_TOKENS = 1536;
export const providers = {
  haiku: { model: 'claude-haiku-4-5', requiredModel: 'claude-haiku-4-5-20251001',
    timeoutMs: 60_000,
    key: 'ANTHROPIC_API_KEY', endpoint: 'https://api.anthropic.com/v1/messages', input: 1, output: 5,
    pricingSource: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  qwen: { model: 'qwen/qwen3-235b-a22b-2507', requiredModel: 'qwen/qwen3-235b-a22b-2507',
    onlyProvider: 'deepinfra/fp8',
    timeoutMs: 300_000,
    key: 'OPENROUTER_API_KEY', endpoint: 'https://openrouter.ai/api/v1/chat/completions', input: 0.09, output: 0.55,
    pricingSource: 'https://openrouter.ai/api/v1/models' },
} as const;

/** Same typed answers and probabilities as Jev, without model-specific task instructions. */
export function answerSchema(request: JevRequest) {
  const object = (properties: Record<string, unknown>) => ({ type: 'object', properties,
    required: Object.keys(properties), additionalProperties: false });
  const answers = Object.fromEntries(Object.entries(request.questions).map(([name, question]) => [name,
    object({ type: { type: 'string', enum: ['choice'] }, choice: { type: 'string', enum: Object.keys(question.criteria) },
      confidence: { type: 'number' }, probabilities: object(Object.fromEntries(Object.keys(question.criteria)
        .map(key => [key, { type: 'number' }]))) })]));
  if (Object.keys(answers).length <= 1) return object({ answers: object(answers) });
  // Coarse/fine macro answers share their shape. Reuse definitions to avoid excessive compiled grammar size.
  const definitions: Record<string, unknown> = {}, shapes = new Map<string, string>();
  const references = Object.fromEntries(Object.entries(answers).map(([name, shape]) => {
    const bytes = JSON.stringify(shape), key = shapes.get(bytes) ?? `answer${shapes.size}`;
    shapes.set(bytes, key); definitions[key] = shape;
    return [name, { $ref: `#/$defs/${key}` }];
  }));
  return { ...object({ answers: object(references) }), $defs: definitions };
}
export function providerRequest(provider: Provider, request: JevRequest) {
  if (Buffer.byteLength(JSON.stringify(request)) > JEV_LIMITS.maxRequestBytes) throw new Error('Request exceeds shared 12KB envelope');
  const schema = answerSchema(request), messages = [{ role: 'user', content: JSON.stringify({ state: request.state, questions: request.questions }) }];
  const common = { model: providers[provider].model, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS, messages };
  return provider === 'haiku' ? { ...common, output_config: { format: { type: 'json_schema', schema } } }
    : { ...common, response_format: { type: 'json_schema', json_schema: { name: 'choice_answers', strict: true, schema } },
      usage: { include: true }, provider: { only: [providers.qwen.onlyProvider], allow_fallbacks: false, require_parameters: true,
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
function billedUsage(provider: Provider, data: Record<string, unknown>) {
  if (provider === 'qwen') {
    const u = z.object({ prompt_tokens: count, completion_tokens: count, cost: z.number().finite().nonnegative() }).parse(data['usage']);
    return { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, costUsd: u.cost };
  }
  const u = usageSchema.parse(data['usage']);
  return { inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens,
    costUsd: (u.input_tokens + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.cache_creation_input_tokens ?? 0) * 1.25 + u.output_tokens * providers.haiku.output) / 1e6 };
}
const caseFailure = (failure: string | null) => ['Invalid typed answer/probability distribution', 'Incomplete provider output', 'Invalid provider output'].includes(failure ?? '');
type ModelResponse = PaidResponse & { failure: string | null };
interface ModelExchange { event: string; requestId: string; runId: string; provider: Provider; request: JevRequest;
  payload: unknown; status: number; body: string; failure: string | null; costUsd: number | null; latencyMs: number }

/** Reconcile every paid model input, retaining invalid answers as failures rather than buying a replacement. */
function modelResponses(directory: string, provider: Provider) {
  const cache = new Map<string, ModelResponse>(), found = new Set<string>(), ledger = join(directory, 'spend.jsonl');
  if (!existsSync(ledger)) return cache;
  const bills = new Map<string, { runId: string; costUsd: number; failure: string | null; reconciled?: boolean; lostOutput?: boolean }>();
  for (const line of readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.event === 'settle' && entry.provider === provider) bills.set(entry.requestId, entry);
    if (entry.event === 'reconcile' && entry.provider === provider && bills.has(entry.requestId)) bills.set(entry.requestId, { ...bills.get(entry.requestId)!, costUsd: 0, reconciled: true });
    if (entry.event === 'reconcile-timeout' && entry.provider === provider && bills.has(entry.requestId)) bills.set(entry.requestId, { ...bills.get(entry.requestId)!, costUsd: entry.costUsd, lostOutput: true });
  }
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, entry.name, `${provider}-exchanges.jsonl`);
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const exchanges: ModelExchange[] = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const responses = new Map(exchanges.filter(e => e.event === 'response').map(e => [e.requestId, e]));
    for (const request of exchanges.filter(e => e.event === 'request')) {
      const bill = bills.get(request.requestId), response = responses.get(request.requestId);
      if (provider === 'qwen' && bill?.lostOutput && response && response.runId === request.runId && bill.runId === request.runId
        && response.provider === provider && request.provider === provider && response.body === '' && response.status === 200
        && response.costUsd === null && Number.isFinite(response.latencyMs) && response.latencyMs >= 60_000
        && JSON.stringify(request.payload) === JSON.stringify(providerRequest(provider, request.request))) {
        const key = requestKey(request.request);
        if (cache.has(key)) throw new Error('Duplicate paid model input in history');
        cache.set(key, { requestId: request.requestId, runId: request.runId, raw: null,
          failure: 'Reconciled transport failure; output unavailable', latencyMs: response.latencyMs });
        found.add(request.requestId); continue;
      }
      if (bill && response && request.provider === provider && response.provider === provider
        && bill.runId === request.runId && response.runId === request.runId && bill.costUsd === 0
        && (response.costUsd === 0 || bill.reconciled && response.costUsd === null) && preInferenceRejection(provider, response.status, response.body)) {
        found.add(request.requestId); continue;
      }
      if (!bill || !response || bill.runId !== request.runId || response.runId !== request.runId || request.provider !== provider
        || response.provider !== provider || response.costUsd !== bill.costUsd || response.failure !== bill.failure
        || !Number.isFinite(response.latencyMs) || response.latencyMs < 0 || response.status !== 200
        || JSON.stringify(request.payload) !== JSON.stringify(providerRequest(provider, request.request))) throw new Error('Model replay lacks matching request, response and settled billing');
      const data = JSON.parse(response.body), usage = billedUsage(provider, data), bound = reservation(provider, request.request);
      if (usage.costUsd !== bill.costUsd || usage.inputTokens > bound.inputTokens || usage.outputTokens > MAX_OUTPUT_TOKENS || usage.costUsd > bound.usd
        || (data.model !== providers[provider].requiredModel && !(provider === 'haiku' && data.model === providers.haiku.model))) throw new Error('Model replay identity or usage differs from billing');
      const failure = response.failure;
      if (failure && !caseFailure(failure)) throw new Error('Prior fatal model failure requires reconciliation');
      let raw: unknown = null;
      if (!failure) {
        if (provider === 'haiku' ? data.stop_reason !== 'end_turn' : data.choices?.[0]?.finish_reason !== 'stop') throw new Error('Incomplete model replay');
        raw = JSON.parse(provider === 'haiku' ? data.content.map((c: { text: string }) => c.text).join('') : data.choices[0].message.content);
        parseChoiceAnswers(request.request, raw);
      }
      const key = requestKey(request.request);
      if (cache.has(key)) throw new Error('Duplicate paid model input in history');
      cache.set(key, { requestId: request.requestId, runId: request.runId, raw, failure, latencyMs: response.latencyMs });
      found.add(request.requestId);
    }
  }
  if ([...bills.keys()].some(id => !found.has(id))) throw new Error('Paid model exchange evidence is missing; refuse duplicate collection');
  return cache;
}

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
  private replay: Map<string, ModelResponse>;
  readonly rawFile: string;
  constructor(readonly provider: Provider, private session: ModelSession, runDirectory: string,
    private apiKey: string, private transport: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error(`${providers[provider].key} is missing; no requests were sent`);
    this.rawFile = join(runDirectory, `${provider}-exchanges.jsonl`);
    this.replay = modelResponses(dirname(session.ledger), provider);
  }
  get stopped() { return this.session.stopped; }
  get unknown() { return this.session.unknown; }
  hasReplay(request: JevRequest) { return this.replay.has(requestKey(request)); }
  async send(request: JevRequest) {
    if (this.stopped) throw new Error('Provider session stopped');
    const key = requestKey(request), cached = this.replay.get(key);
    if (cached) {
      this.session.record(this.rawFile, { event: 'reuse', runId: this.session.runId, context: this.context,
        requestSha256: key, sourceRunId: cached.runId, sourceRequestId: cached.requestId,
        originalLatencyMs: cached.latencyMs, failure: cached.failure, costUsd: 0, at: new Date().toISOString() });
      this.reusedRequests++;
      if (cached.failure) throw new Error(cached.failure);
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
        body: JSON.stringify(payload), signal: AbortSignal.timeout(config.timeoutMs) });
      status = response.status;
      const generationId = response.headers.get('x-generation-id');
      if (generationId && /^gen-[a-zA-Z0-9_-]+$/.test(generationId)) this.session.record(this.rawFile,
        { ...receipt, event: 'headers', context: this.context, status, generationId });
      body = await response.text();
      if (body.includes(this.apiKey)) { body = body.replaceAll(this.apiKey, '[REDACTED]'); failure = 'Credential echo redacted'; }
      const data = JSON.parse(body);
      if (this.provider === 'haiku' && preInferenceRejection(this.provider, status, body)) {
        costUsd = 0; failure = 'Schema grammar rejected before inference';
        throw new Error(failure);
      }
      const usage = billedUsage(this.provider, data);
      const { inputTokens, outputTokens } = usage; costUsd = usage.costUsd;
      let text: string;
      if (this.provider === 'haiku') {
        text = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(data.content).map(c => c.text).join('');
        if (data.stop_reason !== 'end_turn') failure ??= 'Incomplete provider output';
      } else {
        const choices = z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() })).length(1).parse(data.choices);
        text = choices[0]!.message.content;
        if (choices[0]!.finish_reason !== 'stop') failure ??= 'Incomplete provider output';
      }
      if (status !== 200) failure = `HTTP ${status}`;
      if (data.model !== config.requiredModel && !(this.provider === 'haiku' && data.model === config.model)) failure = 'Unexpected provider model identity';
      if (inputTokens > bound.inputTokens || outputTokens > MAX_OUTPUT_TOKENS || costUsd > bound.usd) failure = 'Provider exceeded reserved token/cost envelope';
      raw = JSON.parse(text);
      try { parseChoiceAnswers(request, raw); } catch { failure ??= 'Invalid typed answer/probability distribution'; }
    } catch { failure ??= costUsd === null ? 'Transport/response failure; unknown usage' : 'Invalid provider output'; }
    const latencyMs = performance.now() - started;
    this.knownUsd += costUsd ?? 0;
    // Settle even if response journaling fails, so a known bill is never lost from the ledger.
    try { this.session.record(this.rawFile, { ...receipt, event: 'response', context: this.context, status, body, failure, latencyMs, costUsd }); }
    finally { this.session.settle(receipt, costUsd, failure); }
    if (failure && !caseFailure(failure)) return this.session.stop(failure);
    this.replay.set(key, { ...receipt, raw, latencyMs, failure });
    if (failure) throw new Error(failure);
    return { raw, costUsd: costUsd!, latencyMs };
  }
  close() { this.apiKey = ''; }
}
