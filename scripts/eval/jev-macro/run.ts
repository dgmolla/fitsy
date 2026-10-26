import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { formatReport, historicalStats, macroNames, score, type ItemResult, type Macros } from './score';
import { loadTruth, nutritionQuantity, sha256, type TruthRow } from './truth';

// Endpoint, model, auth, timeout and usage conventions mirror jevDecisionService.ts.
// Kept here because its decision-only request/response types do not describe numeric estimates.
export const PROTOCOL = {
  version: 1, endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' as const,
  timeoutMs: 5_000, retries: 0, maxSpendUsd: 1.00, maxRequestBytes: 12_000, reservedInputTokens: 16_384,
  pricing: { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0,
    source: 'docs/engineering/pipeline/jev-chain-match-eval.md', checkedAt: '2026-10-24' },
  questions: {
    calories: { type: 'number' as const, instructions: 'Estimate total kilocalories for the specified serving.' },
    protein: { type: 'number' as const, instructions: 'Estimate grams of protein for the specified serving.' },
    carbs: { type: 'number' as const, instructions: 'Estimate grams of total carbohydrate for the specified serving.' },
    fat: { type: 'number' as const, instructions: 'Estimate grams of total fat for the specified serving.' },
  },
  catastrophicDefinition: 'calorie absolute percentage error > 50; failures and omissions are misses',
  failureMedian: 'positive infinity; non-finite median serialized as null',
  percentile: 'nearest rank',
};
export const protocolSha256 = sha256(JSON.stringify(PROTOCOL));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({ input_tokens: count.positive(), output_tokens: count });
const answer = z.object({ type: z.literal('number'), value: z.number().finite().nonnegative() });
const responseSchema = z.object({ model: z.string().regex(/^jev-/),
  answers: z.object({ calories: answer, protein: answer, carbs: answer, fat: answer }).strict() });

/** This explicit projection is the ONLY item-dependent input to the provider. */
export function buildMacroRequest(item: TruthRow) {
  const itemText = [item.itemName, item.section, item.description, item.serving].join('\n');
  if (nutritionQuantity.test(itemText)) {
    throw new Error('Item text contains nutrition targets; exclude it before evaluation');
  }
  const request = { model: PROTOCOL.model, questions: PROTOCOL.questions, state: {
    chain: item.chain, itemName: item.itemName,
    description: [item.section ? `Section: ${item.section}` : '', item.description].filter(Boolean).join('\n'), serving: item.serving,
  } };
  if (Buffer.byteLength(JSON.stringify(request)) > PROTOCOL.maxRequestBytes) throw new Error('Jev macro request exceeds 12KB');
  return request;
}

export function canAffordRequest(spentUsd: number) {
  const reservation = PROTOCOL.reservedInputTokens * PROTOCOL.pricing.inputUsdPerMillion / 1_000_000;
  return Number.isFinite(spentUsd) && spentUsd >= 0 && spentUsd + reservation <= PROTOCOL.maxSpendUsd;
}

/** Exactly one POST, no redirects/retries; the caller journals the request before this boundary. */
export async function requestJevMacros(request: ReturnType<typeof buildMacroRequest>, apiKey: string) {
  if (!apiKey.trim()) throw new Error('TYPESAFE_API_KEY is required');
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body) > PROTOCOL.maxRequestBytes) throw new Error('Jev macro request exceeds 12KB');
  const response = await fetch(PROTOCOL.endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(PROTOCOL.timeoutMs),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body,
  });
  return { status: response.status, body: await response.text() };
}

function parseResponse(id: string, status: number, body: string, latencyMs: number): ItemResult {
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return { id, estimate: null, failure: 'Malformed JSON; unknown usage', costUsd: null, latencyMs, model: null }; }
  const usage = z.object({ usage: usageSchema }).safeParse(raw);
  const costUsd = usage.success ? usage.data.usage.input_tokens * PROTOCOL.pricing.inputUsdPerMillion / 1_000_000 : null;
  const parsed = responseSchema.safeParse(raw);
  let failure = costUsd === null ? 'Missing or invalid usage'
    : usage.success && usage.data.usage.input_tokens > PROTOCOL.reservedInputTokens ? 'Reported usage exceeds reserved input envelope'
      : status !== 200 ? `HTTP ${status}` : !parsed.success ? 'Invalid typed macro response' : null;
  if (!Number.isFinite(costUsd ?? 0)) failure = 'Non-finite reported cost';
  const estimate = failure || !parsed.success ? null : Object.fromEntries(macroNames.map(macro =>
    [macro, parsed.data.answers[macro].value])) as Macros;
  return { id, estimate, failure, costUsd, latencyMs, model: parsed.success ? parsed.data.model : null };
}

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
      if (event.event === 'error') result = { id: pending, estimate: null, failure: 'Transport failure; unknown usage', costUsd: null,
        latencyMs: event['latencyMs'], model: null };
      else {
        if (typeof event['body'] !== 'string' || typeof event['status'] !== 'number' || !Number.isInteger(event['status'])) throw new Error('Malformed response event');
        result = parseResponse(pending, event['status'], event['body'], event['latencyMs']);
        if (event['redacted'] === true) { result.estimate = null; result.failure = 'Provider echoed credential; response redacted'; }
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
  if (pending) results.push({ id: pending, estimate: null, failure: 'Interrupted request; unknown usage', costUsd: null, latencyMs: null, model: null });
  if (!ended || results.length !== fixture.truth.rows.length) stopReason ??= 'Incomplete evaluation';
  return { results, stopReason, modelsReturned: [...models] };
}

function parseArgs(argv: string[]) {
  const options = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--(mode|out|journal)=(.+)$/.exec(arg);
    if (!match || options.has(match[1]!)) throw new Error('Usage: --mode=live|replay --out=<new-directory> [--journal=<jev-raw.jsonl>]');
    options.set(match[1]!, match[2]!);
  }
  const mode = options.get('mode') ?? 'replay', out = options.get('out'), journal = options.get('journal');
  if (!['live', 'replay'].includes(mode) || !out || (mode === 'replay') !== Boolean(journal)) throw new Error('Select live or replay, a new output directory, and a journal only for replay');
  // Never turn accidental env/config arguments into reads of credential files.
  if (journal && !journal.endsWith('.jsonl')) throw new Error('Replay requires a .jsonl provider journal');
  return { mode, out: resolve(out), journal };
}

export async function runEvaluation(argv: string[]) {
  const options = parseArgs(argv), fixture = loadTruth(), historical = historicalStats();
  const requests = fixture.truth.rows.map(buildMacroRequest); // Validate EVERY prompt before any live request.
  const apiKey = options.mode === 'live' ? process.env['TYPESAFE_API_KEY'] : undefined;
  if (options.mode === 'live' && !apiKey?.trim()) throw new Error('TYPESAFE_API_KEY is required in the process environment');
  const contents = options.journal ? readFileSync(options.journal, 'utf8') : null;
  const events: JournalEvent[] = contents === null ? [] : parseJournal(contents);
  if (options.mode === 'replay') replayJournal(fixture, events); // Reject incompatible evidence before creating output.
  mkdirSync(options.out, { recursive: false, mode: 0o700 }); // Refuse existing directories, including empty ones.
  const fd = openSync(join(options.out, 'jev-raw.jsonl'), 'wx', 0o600);
  const record = (event: JournalEvent) => { appendFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); };
  try {
    if (options.mode === 'replay') { appendFileSync(fd, contents!); fsyncSync(fd); }
    else {
      const add = (event: JournalEvent) => { record(event); events.push(event); };
      add({ event: 'start', truthSha256: fixture.digest, protocolSha256, protocol: PROTOCOL, timestamp: new Date().toISOString() });
      let spent = 0, stopReason: string | null = null;
      const models = new Set<string>();
      for (const [index, item] of fixture.truth.rows.entries()) {
        if (!canAffordRequest(spent)) { stopReason = '$1.00 spend cap reached'; break; }
        const request = requests[index]!;
        add({ event: 'request', id: item.id, request });
        const start = performance.now();
        let response;
        try { response = await requestJevMacros(request, apiKey!); }
        catch {
          // Exception text can contain headers/credentials. Retain only a safe classified failure.
          add({ event: 'error', id: item.id, latencyMs: performance.now() - start });
          stopReason = 'Unknown usage; stopped without retry'; break;
        }
        const latencyMs = performance.now() - start;
        const redacted = response.body.includes(apiKey!);
        const body = redacted ? response.body.replaceAll(apiKey!, '[REDACTED]') : response.body;
        add({ event: 'response', id: item.id, status: response.status, body, latencyMs, redacted });
        const result = parseResponse(item.id, response.status, body, latencyMs);
        spent += result.costUsd ?? 0;
        if (result.model) models.add(result.model);
        if (result.costUsd === null) stopReason = 'Unknown usage; stopped without retry';
        else if (result.failure === 'Reported usage exceeds reserved input envelope') stopReason = result.failure;
        else if (spent > PROTOCOL.maxSpendUsd) stopReason = 'Reported spend exceeds $1.00; stopped';
        else if (redacted) stopReason = 'Provider echoed credential; response redacted';
        else if (models.size > 1) stopReason = 'jev-latest resolved to multiple model versions';
        if (stopReason) break;
      }
      add({ event: 'end', stopReason });
    }
  } finally { closeSync(fd); }
  const replay = replayJournal(fixture, events);
  const report = { version: 1, mode: options.mode, timestamp: new Date().toISOString(), truthSha256: fixture.digest, protocolSha256,
    protocol: PROTOCOL, stopReason: replay.stopReason, modelsReturned: replay.modelsReturned,
    byChain: Object.fromEntries([...new Set(fixture.truth.rows.map(row => row.chain))].map(chain =>
      [chain, fixture.truth.rows.filter(row => row.chain === chain).length])),
    metrics: score(fixture.truth.rows, replay.results), historical, results: replay.results };
  writeFileSync(join(options.out, 'summary.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(options.out, 'report.md'), formatReport(report), { flag: 'wx', mode: 0o600 });
  return report;
}

if (require.main === module) runEvaluation(process.argv.slice(2)).then(report => {
  process.stdout.write(JSON.stringify({ mode: report.mode, byChain: report.byChain,
    successful: report.metrics.successful, failures: report.metrics.failures, stopReason: report.stopReason }) + '\n');
  if (report.stopReason) process.exitCode = 1;
}).catch((error: unknown) => {
  process.stderr.write(`Jev macro eval failed: ${error instanceof Error ? error.message : 'Invalid evaluation'}\n`);
  process.exitCode = 1;
});
