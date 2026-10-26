import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { collectExperiment, experimentIdentity, parseChoiceAnswers, parseExperimentArgs, replayExperiment,
  saveExperiment, type Exchange, type Experiment, type JournalEvent } from '../lib/jev-experiment';
import { macroBins } from './bins';
import { formatComparison, scoreSlices } from './exploratory-score';
import { coarseChoices, coarseRequest, decodeHierarchical, fineRequest, HIERARCHICAL_PROTOCOL, selectHierarchicalRows } from './hierarchical-bins';
import { parseJournal, replayJournal } from './run';
import { latencyStats, macroNames, type ItemResult, type Macros } from './score';
import { loadTruth, repository, sha256, type TruthRow } from './truth';

export function hierarchicalExperiment(fixture: ReturnType<typeof loadTruth>): Experiment {
  const rows = selectHierarchicalRows(fixture), byId = new Map(rows.map(row => [row.id, row]));
  // Check all coarse and all possible fine questions before credentials or transport.
  for (const row of rows) {
    coarseRequest(row);
    for (let i = 0; i < 12; i++) fineRequest(row, Object.fromEntries(macroNames.map(macro => [macro, `b${i}`])) as Record<keyof Macros, string>);
  }
  return { fixtureSha256: fixture.digest, ids: rows.map(row => row.id), protocol: HIERARCHICAL_PROTOCOL,
    validate: (request, raw) => { parseChoiceAnswers(request, raw); },
    nextRequest: (id, previous) => {
      const row = byId.get(id)!;
      if (!previous.length) return coarseRequest(row);
      if (previous.length === 2) return null;
      const fine = fineRequest(row, coarseChoices(previous[0]!.request, previous[0]!.raw));
      return Object.keys(fine.questions).length ? fine : null;
    } };
}
export function hierarchicalResults(rows: TruthRow[], exchanges: Exchange[]) {
  return rows.flatMap(row => {
    const attempts = exchanges.filter(exchange => exchange.id === row.id);
    if (!attempts.length) return [];
    const coarse = attempts[0]!, fine = attempts[1], failed = attempts.find(exchange => exchange.failure);
    const decoded = failed ? { estimate: null, conditionalEv: null, coarseChoices: null, fineChoices: null,
      partialArgmax: {}, partialConditionalEv: {}, failure: failed.failure }
      : decodeHierarchical(row, coarse.raw, fine?.raw ?? null);
    return [{ id: row.id, ...decoded, argmaxBins: decoded.estimate ? Object.fromEntries(macroNames.map(macro =>
      [macro, decoded.coarseChoices![macro] === 'zero' ? 'zero' : `${decoded.coarseChoices![macro]}/${decoded.fineChoices![macro]}`])) as Record<keyof Macros, string> : null,
      costUsd: attempts.every(exchange => exchange.costUsd !== null) ? attempts.reduce((sum, exchange) => sum + exchange.costUsd!, 0) : null,
      knownCostUsd: attempts.reduce((sum, exchange) => sum + (exchange.costUsd ?? 0), 0),
      latencyMs: attempts.some(exchange => exchange.latencyMs !== null) ? attempts.reduce((sum, exchange) => sum + (exchange.latencyMs ?? 0), 0) : null,
      model: attempts.find(exchange => exchange.model)?.model ?? null, requests: attempts.length }];
  });
}

export function savedV2(fixture: ReturnType<typeof loadTruth>, rows: TruthRow[]) {
  const file = 'scripts/eval/jev-macro/results/2026-10-26-v2/jev-raw.jsonl.gz';
  const contents = gunzipSync(readFileSync(join(repository, file))).toString('utf8');
  const digest = sha256(contents);
  if (digest !== 'cfe8dad5d3593513c2b36253be408697b2954dbb919d4e7d81623a988c0bc39b') throw new Error('Saved v2 journal changed');
  const replay = replayJournal(fixture, parseJournal(contents));
  if (replay.stopReason || replay.modelsReturned.length !== 1 || replay.modelsReturned[0] !== HIERARCHICAL_PROTOCOL.requiredModel) throw new Error('Invalid saved v2 reference');
  const byId = new Map(replay.results.map(result => [result.id, result]));
  const expectedValue = rows.map(row => byId.get(row.id)!);
  const argmax: ItemResult[] = expectedValue.map(result => ({ ...result,
    estimate: result.argmaxBins ? Object.fromEntries(macroNames.map(macro => [macro,
      macroBins[macro].find(bin => bin.name === result.argmaxBins![macro])!.representative])) as Macros : null }));
  return { file, journalSha256Uncompressed: digest, protocolSha256: parseJournal(contents)[0]!['protocolSha256'], expectedValue, argmax };
}

export function replayHierarchical(fixture: ReturnType<typeof loadTruth>, events: JournalEvent[]) {
  const replay = replayExperiment(hierarchicalExperiment(fixture), events);
  return { ...replay, results: hierarchicalResults(selectHierarchicalRows(fixture), replay.exchanges) };
}

export async function runHierarchicalEvaluation(argv: string[]) {
  const options = parseExperimentArgs(argv), fixture = loadTruth(), rows = selectHierarchicalRows(fixture);
  const experiment = hierarchicalExperiment(fixture), reference = savedV2(fixture, rows);
  const replay = await collectExperiment(experiment, options), results = hierarchicalResults(rows, replay.exchanges);
  // The EV is conditional on coarse argmax, never an alternative coarse decoder.
  const comparisons = { 'v3 argmax (primary)': scoreSlices(rows, results),
    'v3 fine conditional EV (secondary)': scoreSlices(rows, results.map(result => ({ ...result, estimate: result.conditionalEv }))),
    'saved v2 EV': scoreSlices(rows, reference.expectedValue), 'saved v2 argmax': scoreSlices(rows, reference.argmax) };
  const metrics = comparisons['v3 argmax (primary)'].all;
  const report = { version: 3, protocolName: 'hierarchical', exploratory: true, mode: options.mode, timestamp: new Date().toISOString(),
    ...experimentIdentity(experiment), truthSha256: fixture.digest, stopReason: replay.stopReason, modelsReturned: replay.modelsReturned,
    selection: { ids: rows.map(row => row.id), excludedIds: fixture.truth.rows.filter(row => !experiment.ids.includes(row.id)).map(row => row.id) },
    byChain: Object.fromEntries([...new Set(rows.map(row => row.chain))].map(chain => [chain, rows.filter(row => row.chain === chain).length])),
    metrics, comparisons, reference, results,
    accounting: { requests: replay.exchanges.length, maxRequests: 336,
      knownCostUsd: replay.exchanges.reduce((sum, exchange) => sum + (exchange.costUsd ?? 0), 0),
      unknownUsageRequests: replay.exchanges.filter(exchange => exchange.costUsd === null).length,
      requestLatency: latencyStats(replay.exchanges.flatMap(exchange => exchange.latencyMs === null ? [] : [exchange.latencyMs])) } };
  const markdown = [
    `**TL;DR:** EXPLORATORY v3 hierarchical scored ${metrics.successful}/168 items; frozen v2 remains unchanged.`, '',
    '# Exploratory Jev hierarchical comparison', '',
    `Mode: ${options.mode}; model(s): ${replay.modelsReturned.join(', ') || 'none'}; stop: ${replay.stopReason ?? 'completed'}.`,
    `Truth SHA-256: \`${fixture.digest}\`; selected IDs SHA-256: \`${report.selectionSha256}\`.`,
    `Protocol SHA-256: \`${report.protocolSha256}\`.`,
    `Reference: \`${reference.file}\`; uncompressed SHA-256: \`${reference.journalSha256Uncompressed}\`.`, '',
    'The fixed selection retains 88 WaBa Grill and 80 Yoshinoya rows, excluding 22 unit-defective drinks before collection.',
    'Both v2 decoders and both v3 decoders use these identical serving IDs and truth, in the original order.', '',
    formatComparison(comparisons),
    '## Frozen design and accounting', '',
    'Primary decoding uses coarse argmax followed by fine argmax midpoint; provider choice breaks ties and confidence has no cutoff.',
    'Coarse zero is exactly zero; overflow fails the item and is never clipped.',
    'The secondary EV normalizes the fine probabilities and is conditional on the chosen coarse interval, with coarse zero still exactly zero.',
    'Each item has at most two POSTs: four 14-choice coarse questions, then one request containing only bounded positive macros with r0..r9 refinements.',
    'Collection requests jev-latest, requires jev-1.14.0 from the first response, reserves 16,384 input tokens per request, caps spend at $1, uses 5-second timeouts and never retries.',
    `Requests attempted: ${report.accounting.requests}/336; known reported spend: $${report.accounting.knownCostUsd.toFixed(8)}; unknown-usage requests: ${report.accounting.unknownUsageRequests}.`,
    'Cost per 1k includes both stages and divides by attempted items; unknown usage leaves total cost unavailable while retaining the known subtotal.',
    'Item latency is the sum of measured request latencies across both stages; request latency is separately retained in summary.json.',
    'Every failed, invalid, overflow, missing, timed-out or incomplete item is a catastrophic miss and contributes infinity to every full-set MdAPE and MAE.',
    'Non-finite aggregates are serialized as null and shown as unavailable; successful-only MdAPEs are separately retained in summary.json.',
    'Catastrophic means strictly >50% absolute calorie error; zero truth is 0% for exact zero and 100% for a positive prediction.',
    'Repeated serving identities and all six categories are retained in summary.json; rows from two chains are correlated.',
    'This exploratory encoding comparison establishes no Haiku/Qwen ranking or production adoption verdict.', '',
  ].join('\n');
  saveExperiment(options.out, report, markdown);
  return report;
}
