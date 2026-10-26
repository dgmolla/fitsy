import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseJournal, replayJournal, type JournalEvent } from './journal';
import { buildMacroRequest, canAffordRequest, parseResponse, PROTOCOL, protocolSha256 } from './protocol';
import { formatReport, historicalStats, score } from './score';
import { loadTruth } from './truth';

export { parseJournal, replayJournal, type JournalEvent } from './journal';
export { buildMacroRequest, canAffordRequest, PROTOCOL, protocolSha256 } from './protocol';

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
  const protocols = argv.filter(arg => arg.startsWith('--protocol='));
  if (protocols.length > 1 || protocols.some(arg => !['--protocol=v2', '--protocol=v3'].includes(arg))) throw new Error('Select --protocol=v2|v3 once');
  if (protocols[0] === '--protocol=v3') {
    const { runHierarchicalEvaluation } = await import('./hierarchical.js');
    return runHierarchicalEvaluation(argv.filter(arg => !arg.startsWith('--protocol=')));
  }
  argv = argv.filter(arg => !arg.startsWith('--protocol='));
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
  const report = { version: 2, mode: options.mode, timestamp: new Date().toISOString(), truthSha256: fixture.digest, protocolSha256,
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
