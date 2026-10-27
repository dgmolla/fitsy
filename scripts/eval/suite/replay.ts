import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JEV_LIMITS, parseChoiceAnswers, type JevRequest } from '../lib/jev-experiment';
import { durableAppend, sha256 } from './fixtures';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export const requestKey = (request: JevRequest) => sha256(JSON.stringify(canonical(request)));
export interface PaidResponse { requestId: string; runId: string; raw: unknown; latencyMs: number }
interface Exchange { event: string; requestId: string; runId: string; request?: JevRequest;
  status?: number; body?: string; failure?: string | null; costUsd?: number | null; latencyMs?: number }

/** Read-only replay index. The additive spend ledger, model and typed response must agree. */
export function paidResponses(directory: string) {
  const cache = new Map<string, PaidResponse | null>();
  const ledger = join(directory, 'spend.jsonl');
  if (!existsSync(ledger)) return cache;
  const settlements = new Map<string, { runId: string; costUsd: number; failure: string | null }>();
  for (const line of readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean)) {
    const entry = JSON.parse(line) as { event: string; requestId: string; runId: string; costUsd: number; failure?: string | null; provider?: string };
    if (entry.event === 'settle' && entry.provider === undefined) settlements.set(entry.requestId, { runId: entry.runId, costUsd: entry.costUsd, failure: entry.failure ?? null });
  }
  const found = new Set<string>();
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = join(directory, entry.name, 'jev-exchanges.jsonl');
    if (!existsSync(file)) continue;
    const exchanges = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s) as Exchange);
    const requests = new Map(exchanges.filter(e => e.event === 'request').map(e => [e.requestId, e]));
    const responses = new Map(exchanges.filter(e => e.event === 'response').map(e => [e.requestId, e]));
    for (const [id, request] of requests) {
      const settled = settlements.get(id), response = responses.get(id);
      if (!settled || settled.runId !== request.runId || !request.request) throw new Error('Replay request lacks reconciled billing');
      found.add(id);
      const key = requestKey(request.request);
      // A billed failure cannot be retried as a new request, even if its usage is known.
      if (!response || response.runId !== request.runId || response.status !== 200 || response.failure
        || settled.failure || response.costUsd !== settled.costUsd || !Number.isFinite(response.latencyMs)) {
        if (!cache.has(key)) cache.set(key, null);
        continue;
      }
      const raw = JSON.parse(response.body!) as { model?: string; usage?: { input_tokens?: number } };
      const tokens = raw.usage?.input_tokens;
      if (raw.model !== JEV_LIMITS.requiredModel || !Number.isSafeInteger(tokens) || tokens! <= 0
        || tokens! > JEV_LIMITS.reservedInputTokens || tokens! * JEV_LIMITS.pricing.inputUsdPerMillion / 1_000_000 !== settled.costUsd) {
        throw new Error('Replay model or usage differs from reconciled billing');
      }
      parseChoiceAnswers(request.request, raw);
      if (!cache.has(key)) cache.set(key, { requestId: id, runId: request.runId, raw, latencyMs: response.latencyMs! });
    }
  }
  if ([...settlements.keys()].some(id => !found.has(id))) throw new Error('Paid exchange evidence is missing; refuse duplicate collection');
  return cache;
}

/** No credential or transport exists on this client: a cache miss cannot spend. */
export class ReplayClient {
  knownUsd = 0;
  stopped: string | null = null;
  requests = 0;
  reusedRequests = 0;
  unknown = false;
  context = '';
  private replay: Map<string, PaidResponse | null>;
  constructor(readonly runId: string, directory: string, private rawFile: string) {
    this.replay = paidResponses(directory);
  }
  async send(request: JevRequest) {
    const key = requestKey(request), cached = this.replay.get(key);
    if (!cached || this.stopped) {
      this.stopped ??= 'Jev replay unavailable; paid transport is disabled';
      throw new Error(this.stopped);
    }
    durableAppend(this.rawFile, { event: 'reuse', runId: this.runId, context: this.context,
      requestSha256: key, sourceRunId: cached.runId, sourceRequestId: cached.requestId,
      originalLatencyMs: cached.latencyMs, costUsd: 0, at: new Date().toISOString() });
    this.reusedRequests++;
    return { raw: structuredClone(cached.raw), costUsd: 0, latencyMs: cached.latencyMs };
  }
}
