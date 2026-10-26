import { parseJevDecision } from '../../../apps/api/services/jevDecisionService';
import { buildDecisionRequest, type Fixture } from './fixture';
import type { DecisionResult } from './score';

export interface JournalEvent { event: string; [key: string]: unknown }
export function resultFromResponse(fixture: Fixture, id: string, status: number, body: string, latencyMs: number): DecisionResult & { modelReturned: string } {
  if (status !== 200) throw new Error(`Provider HTTP ${status}; no retries`);
  const response = parseJevDecision(body), answer = response.answers.chain_item_match;
  const t = fixture.benchmark.thresholds;
  const decision = answer.confidence < t.confidence ? null
    : answer.choice === 'match' && answer.probabilities.match >= t.matchProbability ? true
      : answer.choice === 'no_match' && answer.probabilities.match <= t.noMatchProbability ? false : null;
  return { id, decision, latencyMs, modelReturned: response.model,
    costUsd: response.usage.input_tokens * fixture.benchmark.pricing.inputUsdPerMillion / 1_000_000 };
}

/** Re-score raw outputs against the original labels and protocol. Partial or malformed runs fail closed. */
export function replayJournal(fixture: Fixture, events: JournalEvent[]) {
  const first = events[0];
  if (first?.event !== 'start' || first['benchmarkSha256'] !== fixture.digest
    || typeof first['frozenCommit'] !== 'string' || !/^[a-f0-9]{40}$/.test(first['frozenCommit'])) throw new Error('Journal protocol identity mismatch');
  const results: DecisionResult[] = [];
  const models = new Set<string>();
  let pending: string | null = null, stopReason: string | null = null, ended = false;
  for (const [index, event] of events.entries()) {
    if (index === 0) continue;
    if (ended) throw new Error('Journal contains events after completion');
    if (event.event === 'request') {
      const item = fixture.cases[results.length];
      if (pending || stopReason || !item || event['id'] !== item.id
        || JSON.stringify(event['request']) !== JSON.stringify(buildDecisionRequest(fixture.benchmark, item))) throw new Error('Journal request mismatch');
      pending = item.id;
    } else if (event.event === 'response' || event.event === 'error') {
      if (!pending || event['id'] !== pending || typeof event['latencyMs'] !== 'number'
        || !Number.isFinite(event['latencyMs']) || event['latencyMs'] < 0) throw new Error('Journal response mismatch');
      const id = pending, latencyMs = event['latencyMs'];
      try {
        if (event.event === 'error') throw new Error('Transport failure; no retries');
        if (typeof event['status'] !== 'number' || typeof event['body'] !== 'string') throw new Error('Malformed response event');
        const result = resultFromResponse(fixture, id, event['status'], event['body'], latencyMs);
        results.push(result); models.add(result.modelReturned);
      } catch {
        results.push({ id, decision: null, latencyMs, costUsd: null });
        stopReason = 'Provider, transport or response validation failure; raw output retained, no retries';
      }
      pending = null;
    } else if (event.event === 'end') {
      if (event['stopReason'] !== null && typeof event['stopReason'] !== 'string') throw new Error('Invalid completion event');
      stopReason ??= event['stopReason'];
      ended = true;
    } else throw new Error('Unknown journal event');
  }
  if (!ended || pending || results.length !== fixture.cases.length) stopReason ??= 'Incomplete evaluation';
  if (models.size > 1) stopReason ??= 'Model alias resolved to multiple versions during this run';
  return { results, stopReason, frozenCommit: first['frozenCommit'], modelsReturned: [...models] };
}
