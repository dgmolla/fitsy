import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Only the two explicitly selected exploratory protocols use this collector. */
export const JEV_LIMITS = {
  endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' as const,
  requiredModel: 'jev-1.14.0', timeoutMs: 5_000, retries: 0,
  maxRequestBytes: 12_000, reservedInputTokens: 16_384,
  pricing: { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0,
    source: 'docs/engineering/pipeline/jev-chain-match-eval.md', checkedAt: '2026-10-24' },
};
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface ChoiceQuestion { type: 'choice'; instructions: string; criteria: Record<string, string> }
export interface JevRequest { model: 'jev-latest'; state: Record<string, unknown>; questions: Record<string, ChoiceQuestion> }
const probability = z.number().finite().min(0).max(1);
export function parseChoiceAnswers(request: JevRequest, raw: unknown) {
  const schemas = Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    const names = Object.keys(question.criteria);
    const schema = z.object({ type: z.literal('choice'), choice: z.enum(names as [string, ...string[]]), confidence: probability,
      probabilities: z.object(Object.fromEntries(names.map(key => [key, probability]))).strict(),
    }).refine(answer => Math.abs(Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0) - 1) <= 0.01 + names.length * Number.EPSILON
      && answer.probabilities[answer.choice]! >= Math.max(...Object.values(answer.probabilities)) - 0.02, 'Invalid choice probabilities');
    return [name, schema];
  }));
  return z.object({ answers: z.object(schemas).strict() }).parse(raw).answers;
}
export interface JournalEvent { event: string; [key: string]: unknown }
export interface Exchange {
  id: string; stage: number; request: JevRequest;
  raw: unknown; model: string | null; costUsd: number | null; latencyMs: number | null; failure: string | null;
}
export interface Experiment {
  fixtureSha256: string; ids: string[];
  protocol: typeof JEV_LIMITS & { exploratory: true; maxSpendUsd: number; maxRequestsPerItem: number };
  nextRequest: (id: string, previous: Exchange[]) => JevRequest | null;
  validate: (request: JevRequest, raw: unknown) => void;
}
export function experimentIdentity(experiment: Experiment) {
  return { fixtureSha256: experiment.fixtureSha256, selectionSha256: digest(JSON.stringify(experiment.ids)),
    protocolSha256: digest(JSON.stringify(experiment.protocol)), protocol: experiment.protocol };
}
export function canAfford(spent: number, protocol: Experiment['protocol']) {
  return Number.isFinite(spent) && spent >= 0
    && spent + protocol.reservedInputTokens * protocol.pricing.inputUsdPerMillion / 1_000_000 <= protocol.maxSpendUsd;
}
export function validateRequest(request: JevRequest, protocol: Experiment['protocol']) {
  if (Buffer.byteLength(JSON.stringify(request)) > protocol.maxRequestBytes) throw new Error('Jev request exceeds 12KB');
}

/** A torn final, unterminated write is recoverable; complete malformed lines are not. */
export function parseJournal(contents: string): JournalEvent[] {
  const lines = contents.split('\n'), events: JournalEvent[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let event: unknown;
    try { event = JSON.parse(line); }
    catch {
      if (index !== lines.length - 1) throw new Error('Malformed complete journal line');
      if (events.some(e => e.event === 'end')) throw new Error('Torn journal content after end');
      break;
    }
    if (!event || typeof event !== 'object' || Array.isArray(event) || !('event' in event)) throw new Error('Invalid journal event');
    events.push(event as JournalEvent);
  }
  return events;
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({ usage: z.object({ input_tokens: count.positive(), output_tokens: count }) });
const modelSchema = z.object({ model: z.string().regex(/^jev-/) });

function responseExchange(experiment: Experiment, pending: Exchange, event: JournalEvent): Exchange {
  const result = { ...pending, latencyMs: event['latencyMs'] as number };
  if (event.event === 'error') return { ...result, failure: 'Transport failure; unknown usage' };
  if (typeof event['body'] !== 'string' || !Number.isInteger(event['status'])) throw new Error('Malformed response event');
  try { result.raw = JSON.parse(event['body']); }
  catch { return { ...result, failure: 'Malformed JSON; unknown usage' }; }
  const usage = usageSchema.safeParse(result.raw), model = modelSchema.safeParse(result.raw);
  result.model = model.success ? model.data.model : null;
  result.costUsd = usage.success ? usage.data.usage.input_tokens * experiment.protocol.pricing.inputUsdPerMillion / 1_000_000 : null;
  if (!usage.success) result.failure = 'Missing or invalid usage';
  else if (usage.data.usage.input_tokens > experiment.protocol.reservedInputTokens) result.failure = 'Reported usage exceeds reserved input envelope';
  else if (event['status'] !== 200) result.failure = `HTTP ${String(event['status'])}`;
  else if (!model.success) result.failure = 'Invalid model identity';
  else if (result.model !== experiment.protocol.requiredModel) result.failure = 'Model drift from jev-1.14.0';
  else {
    try { experiment.validate(result.request, result.raw); }
    catch { result.failure = 'Invalid typed choice response'; }
  }
  if (event['redacted'] === true) result.failure = 'Provider echoed credential; response redacted';
  return result;
}

/** Live and replay use the same transition checks, including conditional second requests. */
function session(experiment: Experiment) {
  const identity = experimentIdentity(experiment), exchanges: Exchange[] = [];
  const models = new Set<string>();
  let cursor = 0, previous: Exchange[] = [], pending: Exchange | null = null;
  let started = false, ended = false, spent = 0, stopReason: string | null = null;
  const next = () => {
    if (!started || ended || pending || stopReason || cursor === experiment.ids.length) return null;
    if (!canAfford(spent, experiment.protocol)) { stopReason = 'Local spend cap reached'; return null; }
    const id = experiment.ids[cursor]!, request = experiment.nextRequest(id, previous);
    if (!request || previous.length >= experiment.protocol.maxRequestsPerItem) throw new Error('Invalid experiment request plan');
    validateRequest(request, experiment.protocol);
    return { id, stage: previous.length + 1, request };
  };
  const accept = (event: JournalEvent) => {
    if (ended) throw new Error('Journal event after end');
    if (!started) {
      if (event.event !== 'start' || !Object.entries(identity).every(([key, value]) => isDeepStrictEqual(event[key], value))) {
        throw new Error('Journal fixture/selection/protocol identity mismatch');
      }
      started = true; return;
    }
    if (event.event === 'request') {
      const expected = next();
      if (!expected || event['id'] !== expected.id || event['stage'] !== expected.stage
        || !isDeepStrictEqual(event['request'], expected.request)) throw new Error('Journal request mismatch or budget exceeded');
      pending = { ...expected, raw: null, model: null, costUsd: null, latencyMs: null, failure: null };
    } else if (event.event === 'response' || event.event === 'error') {
      if (!pending || event['id'] !== pending.id || event['stage'] !== pending.stage
        || typeof event['latencyMs'] !== 'number' || !Number.isFinite(event['latencyMs']) || event['latencyMs'] < 0) {
        throw new Error('Journal response mismatch');
      }
      const result = responseExchange(experiment, pending, event);
      exchanges.push(result); previous.push(result); pending = null;
      spent += result.costUsd ?? 0;
      if (result.model) models.add(result.model);
      // Unknown usage, drift and invalid outputs all stop collection without retrying.
      if (result.failure) stopReason = result.failure;
      else if (spent > experiment.protocol.maxSpendUsd) stopReason = 'Reported spend exceeds local cap';
      else if (!experiment.nextRequest(result.id, previous)) { cursor++; previous = []; }
    } else if (event.event === 'end') {
      if (event['stopReason'] !== null && typeof event['stopReason'] !== 'string') throw new Error('Invalid end event');
      stopReason ??= event['stopReason']; ended = true;
    } else throw new Error('Unknown journal event');
  };
  const finish = () => {
    const attempts = pending ? [...exchanges, { ...pending, failure: 'Interrupted request; unknown usage' }] : [...exchanges];
    if (!started) throw new Error('Missing journal start');
    if (!ended || pending || cursor !== experiment.ids.length) stopReason ??= 'Incomplete evaluation';
    return { exchanges: attempts, stopReason, modelsReturned: [...models] };
  };
  return { accept, next, finish, get stopReason() { return stopReason; } };
}

export function replayExperiment(experiment: Experiment, events: JournalEvent[]) {
  const state = session(experiment);
  events.forEach(state.accept);
  return state.finish();
}

export function parseExperimentArgs(argv: string[]) {
  const options = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--(mode|out|journal)=(.+)$/.exec(arg);
    if (!match || options.has(match[1]!)) throw new Error('Usage: --mode=live|replay --out=<new-directory> [--journal=<raw.jsonl>]');
    options.set(match[1]!, match[2]!);
  }
  const mode = options.get('mode') ?? 'replay', out = options.get('out'), journal = options.get('journal');
  if (!['live', 'replay'].includes(mode) || !out || (mode === 'replay') !== Boolean(journal)) throw new Error('Select live or replay, a new output directory, and a journal only for replay');
  if (journal && !journal.endsWith('.jsonl')) throw new Error('Replay requires a .jsonl provider journal');
  return { mode, out: resolve(out), journal };
}

/** Call only after every fixture/request/report dependency has passed offline preflight. */
export async function collectExperiment(experiment: Experiment, options: ReturnType<typeof parseExperimentArgs>) {
  const contents = options.journal ? readFileSync(options.journal, 'utf8') : null;
  const events = contents === null ? [] : parseJournal(contents);
  if (options.mode === 'replay') replayExperiment(experiment, events);
  const apiKey = options.mode === 'live' ? process.env['TYPESAFE_API_KEY'] : undefined;
  if (options.mode === 'live' && !apiKey?.trim()) throw new Error('TYPESAFE_API_KEY is required in the process environment');
  mkdirSync(options.out, { recursive: false, mode: 0o700 });
  const fd = openSync(join(options.out, 'jev-raw.jsonl'), 'wx', 0o600);
  try {
    if (contents !== null) { appendFileSync(fd, contents); fsyncSync(fd); }
    else {
      const state = session(experiment);
      const record = (event: JournalEvent) => {
        appendFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd);
        events.push(event); state.accept(event);
      };
      record({ event: 'start', ...experimentIdentity(experiment), timestamp: new Date().toISOString() });
      for (let plan = state.next(); plan; plan = state.next()) {
        record({ event: 'request', ...plan });
        const start = performance.now();
        let response;
        try {
          const http = await fetch(experiment.protocol.endpoint, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(experiment.protocol.timeoutMs),
            headers: { Authorization: `Bearer ${apiKey!}`, 'Content-Type': 'application/json' }, body: JSON.stringify(plan.request),
          });
          response = { status: http.status, body: await http.text() };
        } catch {
          // Exception messages may contain headers or credentials.
          record({ event: 'error', id: plan.id, stage: plan.stage, latencyMs: performance.now() - start });
          break;
        }
        const redacted = response.body.includes(apiKey!);
        record({ event: 'response', id: plan.id, stage: plan.stage, status: response.status,
          body: redacted ? response.body.replaceAll(apiKey!, '[REDACTED]') : response.body,
          latencyMs: performance.now() - start, redacted });
      }
      record({ event: 'end', stopReason: state.stopReason });
    }
  } finally { closeSync(fd); }
  return replayExperiment(experiment, events);
}

export function saveExperiment(out: string, report: unknown, markdown: string) {
  writeFileSync(join(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(out, 'report.md'), markdown, { flag: 'wx', mode: 0o600 });
}
