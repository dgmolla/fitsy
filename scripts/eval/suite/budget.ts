import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { JEV_LIMITS, parseChoiceAnswers, type JevRequest } from '../lib/jev-experiment';
import { durableAppend, sha256 } from './fixtures';
import { paidResponses, requestKey, type PaidResponse } from './replay';

export const STOP_USD = 4.50;
export const HARD_CAP_USD = 5;
export const RESERVATION_USD = JEV_LIMITS.reservedInputTokens * JEV_LIMITS.pricing.inputUsdPerMillion / 1_000_000;
export interface ChoiceClient {
  knownUsd: number; stopped: string | null; requests: number; reusedRequests: number; unknown: boolean; context: string;
  send(request: JevRequest): Promise<{ raw: unknown; costUsd: number; latencyMs: number }>;
}
interface Receipt { event: 'reserve' | 'settle' | 'reconcile'; requestId: string; runId: string; at: string;
  reserveUsd?: number; costUsd?: number | null; failure?: string | null; provider?: 'haiku' | 'qwen'; responseSha256?: string; usageProofSha256?: string }
/** Narrow observed pre-inference rejections; missing usage on other errors remains unknown. */
export function preInferenceRejection(provider: 'haiku' | 'qwen', status: number, body: string) {
  try {
    const data = JSON.parse(body);
    if (status !== 400 || data.usage || data.choices || data.content) return false;
    if (provider === 'qwen') {
      const metadata = data.error?.metadata, raw = typeof metadata?.raw === 'string' ? JSON.parse(metadata.raw) : metadata?.raw;
      return data.error?.code === 400 && metadata?.provider_name === 'GMICloud' && raw?.error?.type === 'BadRequest'
        && raw.error.message === 'The requested model has been deprecated and is no longer available.';
    }
    return data.type === 'error' && data.error?.type === 'invalid_request_error'
      && ['The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.',
        'Schema is too complex for compilation.'].includes(data.error.message);
  } catch { return false; }
}
function qwenUsageProof(directory: string, response: { at: string; latencyMs: number }) {
  const bytes = readFileSync(join(directory, 'openrouter-before-paid-usage.json'), 'utf8'), proof = JSON.parse(bytes);
  if (proof.provider !== 'qwen' || proof.endpoint !== 'https://openrouter.ai/api/v1/key' || proof.usageDailyUsd !== 0 || proof.byokUsageUsd !== 0
    || !Number.isFinite(Date.parse(proof.at)) || !Number.isFinite(Date.parse(response.at)) || !Number.isFinite(response.latencyMs)
    || Date.parse(proof.at) < Date.parse(response.at) + response.latencyMs || proof.at.slice(0, 10) !== response.at.slice(0, 10)) {
    throw new Error('No same-day zero-usage proof for the unserved Qwen request');
  }
  return sha256(bytes);
}
export function spendState(file: string) {
  const pending = new Map<string, Receipt>(), settled = new Set<string>();
  const unknown = new Map<string, Receipt>();
  let knownUsd = 0, modelKnownUsd = 0;
  if (!existsSync(file)) return { knownUsd, modelKnownUsd, unknown: false, pending: 0 };
  for (const line of readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)) {
    const r = JSON.parse(line) as Receipt;
    if (!r.requestId || !r.runId || !r.at) throw new Error('Invalid spend ledger receipt');
    if (r.event === 'reserve' && !pending.has(r.requestId) && !settled.has(r.requestId) && (r.provider === undefined ? r.reserveUsd === RESERVATION_USD
      : ['haiku', 'qwen'].includes(r.provider) && Number.isFinite(r.reserveUsd) && r.reserveUsd! > 0)) pending.set(r.requestId, r);
    else if (r.event === 'settle' && pending.has(r.requestId) && !settled.has(r.requestId)) {
      const reserved = pending.get(r.requestId)!;
      if (r.provider !== reserved.provider || r.runId !== reserved.runId) throw new Error('Spend settlement differs from reservation');
      pending.delete(r.requestId); settled.add(r.requestId);
      if (r.costUsd === null) unknown.set(r.requestId, r);
      else if (typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0) { knownUsd += r.costUsd; if (r.provider) modelKnownUsd += r.costUsd; }
      else throw new Error('Invalid spend ledger cost');
    } else if (r.event === 'reconcile' && unknown.has(r.requestId) && ['haiku', 'qwen'].includes(r.provider ?? '') && r.costUsd === 0
      && r.runId === unknown.get(r.requestId)!.runId && unknown.get(r.requestId)!.provider === r.provider) {
      const exchanges = readFileSync(join(dirname(file), r.runId, `${r.provider}-exchanges.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      const responses = exchanges.filter(e => e.event === 'response' && e.requestId === r.requestId && e.runId === r.runId && e.provider === r.provider);
      if (responses.length !== 1 || responses[0].costUsd !== null || !preInferenceRejection(r.provider!, responses[0].status, responses[0].body)
        || sha256(responses[0].body) !== r.responseSha256) throw new Error('Invalid pre-inference rejection reconciliation');
      if (r.provider === 'qwen' && qwenUsageProof(dirname(file), responses[0]) !== r.usageProofSha256) throw new Error('Qwen usage proof changed');
      unknown.delete(r.requestId);
    } else throw new Error('Invalid spend ledger sequence');
  }
  return { knownUsd, modelKnownUsd, unknown: unknown.size > 0 || pending.size > 0, pending: pending.size };
}

/** Add a zero-inference reconciliation without replacing the original unknown settlement or response. */
export function reconcileRejection(directory: string, runId: string, requestId: string, provider: 'haiku' | 'qwen' = 'haiku') {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid reconciliation run ID');
  const lock = join(directory, '.jev.lock'), fd = openSync(lock, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, runId, phase: 'reconcile', startedAt: new Date().toISOString() }) + '\n'); }
  finally { closeSync(fd); }
  try {
    const ledger = join(directory, 'spend.jsonl'), entries: Receipt[] = readFileSync(ledger, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    spendState(ledger);
    const settled = entries.find(e => e.event === 'settle' && e.requestId === requestId && e.runId === runId && e.provider === provider);
    if (settled?.costUsd !== null || entries.some(e => e.event === 'reconcile' && e.requestId === requestId)) throw new Error('No unreconciled unknown provider settlement');
    const exchanges = readFileSync(join(directory, runId, `${provider}-exchanges.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const responses = exchanges.filter(e => e.event === 'response' && e.requestId === requestId && e.runId === runId && e.provider === provider);
    if (responses.length !== 1 || responses[0].costUsd !== null || !preInferenceRejection(provider, responses[0].status, responses[0].body)) throw new Error('No documented pre-inference rejection');
    const usageProofSha256 = provider === 'qwen' ? qwenUsageProof(directory, responses[0]) : undefined;
    durableAppend(ledger, { provider, requestId, runId, at: new Date().toISOString(), event: 'reconcile', costUsd: 0,
      responseSha256: sha256(responses[0].body), ...(usageProofSha256 ? { usageProofSha256 } : {}), failure: 'Request rejected before inference' });
    return spendState(ledger);
  } finally { unlinkSync(lock); }
}

/** One exclusive durable ledger across all suite runs; an unknown bill blocks further collection. */
export class JevClient {
  readonly ledger: string;
  readonly rawFile: string;
  readonly lock: string;
  knownUsd: number;
  stopped: string | null = null;
  requests = 0;
  reusedRequests = 0;
  unknown = false;
  context = '';
  private closed = false;
  private replay: Map<string, PaidResponse | null>;
  constructor(readonly runId: string, resultsDirectory: string, runDirectory: string, private apiKey: string,
    private transport: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error('TYPESAFE_API_KEY is required for explicit live Jev execution');
    mkdirSync(resultsDirectory, { recursive: true });
    this.ledger = join(resultsDirectory, 'spend.jsonl');
    this.rawFile = join(runDirectory, 'jev-exchanges.jsonl');
    this.lock = join(resultsDirectory, '.jev.lock');
    const fd = openSync(this.lock, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() }) + '\n'); }
    finally { closeSync(fd); }
    try {
      const state = spendState(this.ledger);
      this.knownUsd = state.knownUsd;
      if (state.unknown) throw new Error('Unknown prior Jev usage; reconcile real billing before any further calls');
      if (this.knownUsd + RESERVATION_USD > STOP_USD) throw new Error('Cumulative Jev stop threshold reached');
      this.replay = paidResponses(resultsDirectory);
    } catch (error) { unlinkSync(this.lock); throw error; }
  }
  get remainingUsd() { return Math.max(0, STOP_USD - this.knownUsd); }
  private stop(message: string): never { this.stopped = message; throw new Error(message); }
  private record(file: string, value: unknown) {
    try { durableAppend(file, value); }
    catch { this.unknown = true; this.stop('Journal write failed; stop and reconcile the reserved request before further collection'); }
  }
  async send(request: JevRequest): Promise<{ raw: unknown; costUsd: number; latencyMs: number }> {
    if (this.closed || this.stopped) throw new Error('Jev client stopped');
    if (Buffer.byteLength(JSON.stringify(request)) > JEV_LIMITS.maxRequestBytes) return this.stop('Request exceeds reserved 12KB envelope');
    const key = requestKey(request), cached = this.replay.get(key);
    if (cached === null) return this.stop('Identical request previously billed unsuccessfully; no automatic retry');
    if (cached) {
      this.record(this.rawFile, { event: 'reuse', at: new Date().toISOString(), runId: this.runId,
        context: this.context, requestSha256: key, sourceRunId: cached.runId, sourceRequestId: cached.requestId,
        originalLatencyMs: cached.latencyMs, costUsd: 0 });
      this.reusedRequests++;
      return { raw: structuredClone(cached.raw), costUsd: 0, latencyMs: cached.latencyMs };
    }
    if (this.knownUsd + RESERVATION_USD > STOP_USD) return this.stop('Cumulative Jev stop threshold reached');
    const requestId = randomUUID();
    const receipt = { requestId, runId: this.runId, at: new Date().toISOString() };
    this.record(this.ledger, { ...receipt, event: 'reserve', reserveUsd: RESERVATION_USD });
    this.record(this.rawFile, { ...receipt, event: 'request', context: this.context, request });
    const start = performance.now();
    this.requests++;
    let status = 0, body = '', failure: string | null = null, costUsd: number | null = null, raw: unknown;
    try {
      const response = await this.transport(JEV_LIMITS.endpoint, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(JEV_LIMITS.timeoutMs) });
      status = response.status;
      body = await response.text();
      if (body.includes(this.apiKey)) { body = body.replaceAll(this.apiKey, '[REDACTED]'); failure = 'Credential echo redacted'; }
      try { raw = JSON.parse(body); } catch { failure ??= 'Malformed JSON; unknown usage'; }
      const usage = z.object({ usage: z.object({ input_tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        output_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }) }).safeParse(raw);
      if (usage.success) {
        costUsd = usage.data.usage.input_tokens * JEV_LIMITS.pricing.inputUsdPerMillion / 1_000_000;
        if (usage.data.usage.input_tokens > JEV_LIMITS.reservedInputTokens) failure ??= 'Provider exceeded reserved token envelope';
      } else failure ??= 'Missing or invalid usage';
      if (status !== 200) failure ??= `HTTP ${status}`;
      if (!z.object({ model: z.literal(JEV_LIMITS.requiredModel) }).safeParse(raw).success) failure ??= 'Unexpected Jev model identity';
      try { parseChoiceAnswers(request, raw); } catch { failure ??= 'Invalid typed answer/probability distribution'; }
    } catch { failure = 'Transport failure; unknown usage'; }
    const latencyMs = performance.now() - start;
    this.knownUsd += costUsd ?? 0;
    this.unknown ||= costUsd === null;
    this.record(this.rawFile, { ...receipt, event: 'response', context: this.context, status, body, failure, latencyMs, costUsd });
    this.record(this.ledger, { ...receipt, event: 'settle', costUsd, failure });
    if (this.knownUsd >= STOP_USD) failure ??= 'Cumulative Jev stop threshold reached';
    if (failure) return this.stop(failure);
    this.replay.set(key, { requestId, runId: this.runId, raw, latencyMs });
    return { raw, costUsd: costUsd!, latencyMs };
  }
  close() {
    if (!this.closed) { this.closed = true; this.apiKey = ''; unlinkSync(this.lock); }
  }
}
