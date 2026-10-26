import { isDeepStrictEqual } from 'node:util';
import { buildMacroRequest, canAffordRequest, parseResponse, PROTOCOL, protocolSha256 } from './protocol';
import type { ItemResult } from './score';
import type { loadTruth } from './truth';

export interface JournalEvent { event: string; [key: string]: unknown }
type Fixture = ReturnType<typeof loadTruth>;
export function parseJournal(contents: string): JournalEvent[] {
  const lines = contents.split('\n');
  const events: JournalEvent[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      // A crash can tear the final write. Only an unterminated last line may be discarded.
      if (index !== lines.length - 1) throw new Error('Malformed complete journal line');
      if (events.some(previous => previous.event === 'end')) throw new Error('Torn journal content after end');
      break;
    }
    if (!event || typeof event !== 'object' || Array.isArray(event) || !('event' in event)) throw new Error('Invalid journal event');
    events.push(event as JournalEvent);
  }
  return events;
}
export function replayJournal(fixture: Fixture, events: JournalEvent[]) {
  const start = events[0];
  if (start?.event !== 'start' || start['truthSha256'] !== fixture.digest || start['protocolSha256'] !== protocolSha256
    || !isDeepStrictEqual(start['protocol'], PROTOCOL)) throw new Error('Journal truth/protocol identity mismatch');
  const results: ItemResult[] = [], models = new Set<string>();
  let pending: string | null = null, ended = false, stopReason: string | null = null, spent = 0;
  for (const event of events.slice(1)) {
    if (ended) throw new Error('Journal event after end');
    if (event.event === 'request') {
      const item = fixture.truth.rows[results.length];
      if (pending || stopReason || !item || event['id'] !== item.id || !canAffordRequest(spent)
        || !isDeepStrictEqual(event['request'], buildMacroRequest(item))) throw new Error('Journal request mismatch or budget exceeded');
      pending = item.id;
    } else if (event.event === 'response' || event.event === 'error') {
      if (!pending || event['id'] !== pending || typeof event['latencyMs'] !== 'number'
        || !Number.isFinite(event['latencyMs']) || event['latencyMs'] < 0) throw new Error('Journal response mismatch');
      let result: ItemResult;
      if (event.event === 'error') result = { id: pending, estimate: null, argmaxBins: null, failure: 'Transport failure; unknown usage', costUsd: null,
        latencyMs: event['latencyMs'], model: null };
      else {
        if (typeof event['body'] !== 'string' || typeof event['status'] !== 'number' || !Number.isInteger(event['status'])) throw new Error('Malformed response event');
        result = parseResponse(pending, event['status'], event['body'], event['latencyMs']);
        if (event['redacted'] === true) { result.estimate = null; result.argmaxBins = null; result.failure = 'Provider echoed credential; response redacted'; }
      }
      results.push(result); pending = null;
      spent += result.costUsd ?? 0;
      if (result.model) models.add(result.model);
      if (result.costUsd === null) stopReason = 'Unknown usage; stopped without retry';
      else if (result.failure === 'Reported usage exceeds reserved input envelope') stopReason = result.failure;
      else if (spent > PROTOCOL.maxSpendUsd) stopReason = 'Reported spend exceeds $1.00; stopped';
      else if (event['redacted'] === true) stopReason = result.failure;
      else if (models.size > 1) stopReason = 'jev-latest resolved to multiple model versions';
    } else if (event.event === 'end') {
      if (event['stopReason'] !== null && typeof event['stopReason'] !== 'string') throw new Error('Invalid end event');
      stopReason ??= event['stopReason']; ended = true;
    } else throw new Error('Unknown journal event');
  }
  if (pending) results.push({ id: pending, estimate: null, argmaxBins: null, failure: 'Interrupted request; unknown usage', costUsd: null, latencyMs: null, model: null });
  if (!ended || results.length !== fixture.truth.rows.length) stopReason ??= 'Incomplete evaluation';
  return { results, stopReason, modelsReturned: [...models] };
}
