import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { JEV_LIMITS, parseChoiceAnswers, type JevRequest } from '../lib/jev-experiment';
import { durableAppend } from './fixtures';
import { paidResponses, requestKey, type PaidResponse } from './replay';

export const STOP_USD = 4.50;
export const HARD_CAP_USD = 5;
export const RESERVATION_USD = JEV_LIMITS.reservedInputTokens * JEV_LIMITS.pricing.inputUsdPerMillion / 1_000_000;
interface Receipt { event: 'reserve' | 'settle'; requestId: string; runId: string; at: string;
  reserveUsd?: number; costUsd?: number | null; failure?: string | null }
export function spendState(file: string) {
  const pending = new Set<string>(), settled = new Set<string>();
  let knownUsd = 0, unknown = false;
  if (!existsSync(file)) return { knownUsd, unknown, pending: 0 };
  for (const line of readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)) {
    const r = JSON.parse(line) as Receipt;
    if (!r.requestId || !r.runId || !r.at) throw new Error('Invalid spend ledger receipt');
    if (r.event === 'reserve' && !pending.has(r.requestId) && !settled.has(r.requestId) && r.reserveUsd === RESERVATION_USD) pending.add(r.requestId);
    else if (r.event === 'settle' && pending.delete(r.requestId) && !settled.has(r.requestId)) {
      settled.add(r.requestId);
      if (r.costUsd === null) unknown = true;
      else if (typeof r.costUsd === 'number' && Number.isFinite(r.costUsd) && r.costUsd >= 0) knownUsd += r.costUsd;
      else throw new Error('Invalid spend ledger cost');
    } else throw new Error('Invalid spend ledger sequence');
  }
  return { knownUsd, unknown: unknown || pending.size > 0, pending: pending.size };
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
