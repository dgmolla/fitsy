const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const { loadCases, sha256 } = require(root + '/scripts/eval/suite/fixtures.ts');
const { score } = require(root + '/scripts/eval/suite/metrics.ts');
const { spendState, preInferenceRejection } = require(root + '/scripts/eval/suite/budget.ts');
const { requestKey } = require(root + '/scripts/eval/suite/replay.ts');
const { payloadKey, payloadRevision } = require(root + '/scripts/eval/suite/providers.ts');
const repair = process.argv[4] === '--haiku-format-fix';
assert(process.argv[4] === undefined || repair);
const base = path.join(root, 'scripts/eval/suite/results');
const runId = process.argv[2];
assert.match(runId, /^[a-zA-Z0-9_-]+$/);
const out = path.join(base, runId);
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = file => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const metadata = json(path.join(out, 'run.json'));
const summary = json(path.join(out, 'summary.json'));
const preflight = json(path.join(base, 'haiku-qwen-dev-sample-preflight.json'));
const fixture = loadCases('dev', 'both');
assert.equal(metadata.config.split, 'dev');
assert.equal(summary.stopReason, null);
assert.deepEqual(metadata.config.methods, ['exact', 'jev-v3', 'haiku', 'qwen']);
assert.deepEqual(metadata.selectionIds, preflight.selection.selectionIds);
assert.equal(metadata.selectionSha256, preflight.selection.selectionSha256);
assert.equal(metadata.fixtureSha256, fixture.fixtureSha256);
assert.equal(metadata.checksum, fixture.checksum);
assert.equal(metadata.selected, 129);
const selected = metadata.selectionIds.map(id => fixture.cases.find(c => c.id === id));
assert(selected.every(c => c && c.split === 'dev'));
assert.equal(fs.existsSync(path.join(base, 'holdout-runs.jsonl')), false);
const predictions = lines(path.join(out, 'predictions.jsonl'));
assert.equal(predictions.length, 465);
const scores = {};
for (const method of metadata.config.methods) {
  const eligible = selected.filter(c => method !== 'exact' || c.task === 'matching');
  const actual = predictions.filter(r => r.method === method);
  assert.deepEqual([...actual.map(r => r.id)].sort(), [...eligible.map(c => c.id)].sort());
  for (const tier of ['curated', 'bulk']) for (const task of ['matching', 'macro']) {
    if (method === 'exact' && task === 'macro') continue;
    const cases = eligible.filter(c => c.tier === tier && c.task === task);
    const ids = new Set(cases.map(c => c.id));
    const key = `${tier}/${task}/${method}`;
    scores[key] = score(cases, actual.filter(r => ids.has(r.id)));
    assert.deepEqual(scores[key], summary.scores[key]);
    assert.equal(scores[key].missing, 0);
  }
}
const aggregate = Object.fromEntries(metadata.config.methods.map(method => [method, Object.fromEntries(['matching', 'macro']
  .filter(task => method !== 'exact' || task !== 'macro').map(task => {
    const cases = selected.filter(c => c.task === task), ids = new Set(cases.map(c => c.id));
    return [task, score(cases, predictions.filter(r => r.method === method && ids.has(r.id)))];
  }))]));
const ledgerBytes = fs.readFileSync(path.join(base, 'spend.jsonl'));
assert.equal(sha256(ledgerBytes.subarray(0, preflight.ledger.bytes)), preflight.ledger.sha256);
const ledger = lines(path.join(base, 'spend.jsonl'));
const state = spendState(path.join(base, 'spend.jsonl'));
assert.equal(state.unknown, false);
assert.equal(state.pending, 0);
assert(state.knownUsd < 2.7 && state.knownUsd < 3);
const settlements = new Map(ledger.filter(e => e.event === 'settle').map(e => [e.requestId, e]));
for (const receipt of ledger.filter(e => e.event === 'reconcile')) settlements.set(receipt.requestId, { ...settlements.get(receipt.requestId), costUsd: receipt.costUsd, reconciled: true });
for (const receipt of ledger.filter(e => e.event === 'reconcile-timeout')) settlements.set(receipt.requestId, { ...settlements.get(receipt.requestId), costUsd: receipt.costUsd, reconciledTimeout: true, costBasis: receipt.basis || 'usage-counter' });
const requests = new Map(), responses = new Map();
for (const dir of fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())) {
  for (const provider of ['jev', 'haiku', 'qwen']) {
    const file = path.join(base, dir.name, provider + '-exchanges.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const e of lines(file)) {
      if (e.event === 'request') requests.set(e.runId + '/' + e.requestId, e);
      if (e.event === 'response') responses.set(e.runId + '/' + e.requestId, e);
    }
  }
}
const newEvents = ledger.slice(preflight.ledger.lines);
assert(newEvents.every(e => e.provider === 'haiku' || e.provider === 'qwen'));
const paidInputs = new Set(), newCosts = { exact: 0, 'jev-v3': 0, haiku: 0, qwen: 0 }, groupCosts = {};
const newRequestReceipts = [], rejectedRequests = [];
for (const reserve of newEvents.filter(e => e.event === 'reserve')) {
  const key = reserve.runId + '/' + reserve.requestId, request = requests.get(key), response = responses.get(key), bill = settlements.get(reserve.requestId);
  assert(request && response && bill && bill.costUsd !== null);
  assert.equal(bill.runId, reserve.runId);
  assert.equal(bill.provider, reserve.provider);
  assert(request.context.startsWith(reserve.provider + '/'));
  const id = request.context.slice(reserve.provider.length + 1), c = selected.find(c => c.id === id);
  assert(c, 'New spend must belong to the original fixed sample');
  if (response.status === 400) {
    assert(preInferenceRejection(reserve.provider, response.status, response.body)); assert.equal(bill.costUsd, 0);
    rejectedRequests.push({ runId: reserve.runId, requestId: reserve.requestId, costUsd: 0 });
    continue;
  }
  assert.equal(response.status, 200);
  if (bill.reconciledTimeout) { assert.equal(response.costUsd, null); assert.equal(response.body, ''); assert(bill.costUsd <= reserve.reserveUsd); }
  else assert.equal(response.costUsd, bill.costUsd);
  payloadRevision(reserve.provider, request.request, request.payload);
  const input = reserve.provider + '/' + payloadKey(request.payload);
  assert.equal(paidInputs.has(input), false, 'A byte-identical paid model payload was repeated');
  paidInputs.add(input);
  newCosts[reserve.provider] += bill.costUsd;
  const group = `${c.tier}/${c.task}/${reserve.provider}`;
  groupCosts[group] = (groupCosts[group] || 0) + bill.costUsd;
  newRequestReceipts.push({ provider: reserve.provider, runId: reserve.runId, requestId: reserve.requestId, requestSha256: requestKey(request.request), payloadSha256: payloadKey(request.payload), caseId: id, costUsd: bill.costUsd,
    costBasis: bill.reconciledTimeout ? bill.costBasis === 'generation-metadata' ? 'Exact captured-generation billing metadata' : 'Allocated from stable same-key provider usage counters' : 'Provider response usage' });
}
assert(Math.abs(newCosts.haiku + newCosts.qwen - state.modelKnownUsd) < 1e-10);
const transport = new Map(), referenceCosts = new Map();
for (const [method, filePrefix] of [['jev-v3', 'jev'], ['haiku', 'haiku'], ['qwen', 'qwen']]) {
  const exchanges = lines(path.join(out, filePrefix + '-exchanges.jsonl'));
  if (metadata.config.replayOnly || method === 'jev-v3') assert(exchanges.every(e => e.event === 'reuse')); 
  for (const e of exchanges.filter(e => e.event === 'request' || e.event === 'reuse')) {
    const key = e.event === 'request' ? e.runId + '/' + e.requestId : e.sourceRunId + '/' + e.sourceRequestId;
    const source = responses.get(key), bill = settlements.get(e.event === 'request' ? e.requestId : e.sourceRequestId);
    assert(source && bill && bill.costUsd !== null);
    if (e.event === 'reuse') assert.equal(e.originalLatencyMs, source.latencyMs);
    transport.set(e.context, (transport.get(e.context) || 0) + source.latencyMs);
    referenceCosts.set(e.context, (referenceCosts.get(e.context) || 0) + bill.costUsd);
  }
}
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
const performance = {};
for (const method of metadata.config.methods) for (const tier of ['curated', 'bulk', 'both']) {
  const results = predictions.filter(r => r.method === method && (tier === 'both' || selected.find(c => c.id === r.id).tier === tier));
  const keys = results.map(r => method + '/' + r.id);
  const cost = tier === 'both' ? newCosts[method] : ['matching', 'macro'].reduce((sum, task) => sum + (groupCosts[`${tier}/${task}/${method}`] || 0), 0);
  performance[`${tier}/${method}`] = { cases: results.length, newCostUsd: cost, newCostPer1000Usd: cost * 1000 / results.length,
    referenceCostPer1000Usd: keys.reduce((sum, k) => sum + (referenceCosts.get(k) || 0), 0) * 1000 / results.length,
    p95ExecutionMs: p95(results.map(r => r.latencyMs)),
    p95RecordedTransportMs: method === 'exact' ? null : p95(keys.map(k => { assert(transport.has(k)); return transport.get(k); })) };
}
const baselineId = process.argv[3];
assert.match(baselineId, /^[a-zA-Z0-9_-]+$/);
const baseline = json(path.join(base, baselineId, 'comparison-audit.json'));
const diagnosis = repair ? json(path.join(base, 'haiku-format-preflight/diagnosis.json')) : null;
const normalized = repair ? json(path.join(base, 'haiku-format-preflight/normalized-summary.json')) : null;
if (repair) {
  assert.equal(diagnosis.baselineId, baselineId);
  assert.equal(diagnosis.ledger.sha256, baseline.finalLedgerSha256);
  assert.equal(sha256(ledgerBytes.subarray(0, diagnosis.ledger.bytes)), diagnosis.ledger.sha256, 'Original ledger must remain an exact prefix');
  const repairEvents = ledgerBytes.subarray(diagnosis.ledger.bytes).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
  assert(repairEvents.every(e => e.provider === 'haiku'));
  for (const e of repairEvents.filter(e => e.event === 'reserve')) {
    const request = requests.get(e.runId + '/' + e.requestId);
    assert(diagnosis.failedCaseIds.includes(request.context.slice('haiku/'.length)), 'Only failed Haiku cases may be rerun');
    assert.equal(payloadRevision('haiku', request.request, request.payload), 'haiku-probability-v2');
  }
} else assert.equal(sha256(ledgerBytes), baseline.finalLedgerSha256, 'Reparse must not mutate the ledger');
assert.equal(summary.accounting.requests, 0);
assert.equal(summary.accounting.runKnownUsd, 0);
const before = lines(path.join(base, baselineId, 'predictions.jsonl'));
const beforeByKey = new Map(before.map(r => [r.method + '/' + r.id, r]));
let recoveredCases = 0;
for (const r of predictions) {
  const old = beforeByKey.get(r.method + '/' + r.id); assert(old);
  if (!old.failure) { assert.deepEqual(r.output, old.output); assert.equal(r.failure, null); }
  else if (!r.failure) recoveredCases++;
}
const failureCounts = Object.fromEntries(Object.entries(scores).map(([key, m]) => [key, m.failureCounts]));
const reparse = { baselineId, baselineLedgerSha256: baseline.finalLedgerSha256,
  newSpendUsd: repair ? state.knownUsd - diagnosis.ledger.knownUsd : 0,
  newRequests: repair ? newRequestReceipts.filter(r => !baseline.paidRequestReceipts.some(old => old.requestId === r.requestId)).length : 0,
  recoveredCases, failureCounts };
const diagnostics = [];
const { decodeProviderOutput } = require(root + '/scripts/eval/suite/providers.ts');
for (const [key, request] of requests) {
  if (!['haiku', 'qwen'].includes(request.provider)) continue;
  const response = responses.get(key);
  if (!response || response.status !== 200 || !response.failure || response.body === '') continue;
  const data = JSON.parse(response.body);
  try { decodeProviderOutput(request.provider, request.request, data); }
  catch (error) {
    let answers;
    try { answers = JSON.parse(request.provider === 'haiku' ? data.content.map(c => c.text).join('') : data.choices[0].message.content).answers; } catch { /* Keep malformed JSON separate. */ }
    const probabilityChecks = Object.entries(answers || {}).map(([name, a]) => ({ name, choice: a.choice,
      sum: Object.values(a.probabilities || {}).reduce((n, p) => n + p, 0),
      chosenProbability: a.probabilities?.[a.choice], maximumProbability: Math.max(...Object.values(a.probabilities || {})) }));
    diagnostics.push({ provider: request.provider, requestId: request.requestId, runId: request.runId,
      context: request.context, stage: 'match' in request.request.questions ? 'matching' : JSON.stringify(request.request.questions).includes('"overflow"') ? 'coarse' : 'fine',
      originalFailure: response.failure, currentFailure: error.message, kind: error.kind, probabilityChecks });
  }
}
fs.writeFileSync(path.join(out, 'failure-diagnosis.json'), JSON.stringify({ reparse, diagnostics }, null, 2) + '\n', { flag: 'wx' });
const audit = { generatedAt: new Date().toISOString(), runId, sourceHead: metadata.head, fixedSelectionSha256: metadata.selectionSha256,
  cases: 129, predictions: predictions.length, counts: { curatedMatching: 34, curatedMacro: 25, bulkMatching: 44, bulkMacro: 26 },
  originalLedgerPrefixPreserved: true, originalLedgerSha256: preflight.ledger.sha256, finalLedgerSha256: sha256(ledgerBytes),
  duplicatePaidInputs: 0, newJevRequests: 0, paidModelRequests: paidInputs.size, rejectedRequests, newCosts,
  actualNewSpendUsd: state.modelKnownUsd, cumulativeIncludingHistoricalJevUsd: state.knownUsd, unknownUsage: false, pending: 0,
  holdoutRunLogAbsent: true, reparse, scores, aggregate, normalized: normalized?.scores ?? null, performance, paidRequestReceipts: newRequestReceipts };
fs.writeFileSync(path.join(out, 'comparison-audit.json'), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
const pct = value => value === null ? 'N/A' : (value * 100).toFixed(1) + '%';
const countRate = (n, total) => `${n}/${total} (${pct(total ? n / total : null)})`;
const report = [
  '**TL;DR:** Strict scoring retains 129 DEV cases; Haiku repair spends $' + reparse.newSpendUsd.toFixed(8) + '; cumulative ledger is $' + state.knownUsd.toFixed(8) + '.',
  '',
  '# Haiku and Qwen DEV sample comparison',
  '',
  'Generated from the committed-source run, original preflight, predictions, raw exchanges and additive spend ledger.',
  'The sample contains 34 curated matching, 25 curated macro, 44 bulk matching and 26 bulk macro cases.',
  'The original `modelSelection` chose these IDs before any paid output, with a $2.69768053 reservation under the $2.70 stop and $3 hard cap.',
  'The ordered selection SHA-256 is `' + metadata.selectionSha256 + '`.',
  'Source head: `' + metadata.head + '`; final run: `' + runId + '`.',
  'Every matching method completed the same 78 matching cases, and every supported estimator completed the same 51 macro cases.',
  'Exact has no macro estimator, so its macro measurements are explicitly unavailable.',
  'No holdout evaluation or database connection is part of this comparison.',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Frozen 129 DEV cases] --> B[Exact matching]',
  '  A --> C[Jev cached responses]',
  '  A --> D[Haiku responses]',
  '  A --> E[Qwen responses]',
  '  B --> F[Fixed scoring and bill audit]',
  '  C --> F',
  '  D --> F',
  '  E --> F',
  '```',
  '',
  '## Matching',
  '',
  '| Tier | Method | Pass | Wrong matches | Recall | Abstain |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
];
for (const tier of ['curated', 'bulk']) for (const method of metadata.config.methods) {
  const m = scores[`${tier}/matching/${method}`];
  report.push(`| ${tier} | ${method} | ${countRate(m.passed, m.total)} | ${countRate(m.wrongMatches, m.total)} | ${countRate(m.truePositives, m.positives)} | ${countRate(m.abstentions, m.total)} |`);
}
report.push('', 'Pass requires the exact expected ID or explicit NO MATCH.',
  'Wrong counts returned IDs that differ from the expected match; missed positives reduce recall.',
  'Abstentions and invalid outputs fail the pass metric.', '', '## Macro estimation', '',
  '| Tier | Method | View | N | Median error % Cal/P/C/F | >50% calorie error | Zero correct | All four within 25% | Parse/format | Timeout | Abstain |',
  '| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const tier of ['curated', 'bulk']) for (const method of metadata.config.methods) {
  const cases = selected.filter(c => c.tier === tier && c.task === 'macro');
  if (method === 'exact') { report.push(`| ${tier} | exact | N/A | ${cases.length} selected | N/A | N/A | N/A | N/A | N/A | N/A | N/A |`); continue; }
  const all = scores[`${tier}/macro/${method}`];
  for (const [view, m] of [['all cases', all], ['parsed only', all.parsedOnly]]) {
    const errors = ['calories', 'protein', 'carbs', 'fat'].map(k => m.medianPercentError[k] === null ? m.total ? 'infinity' : 'N/A' : m.medianPercentError[k].toFixed(1)).join('/');
    report.push(`| ${tier} | ${method} | ${view} | ${m.total} | ${errors} | ${countRate(m.bigMisses, m.total)} | ${countRate(m.zeroCorrect, m.zeroTotal)} | ${countRate(m.passed, m.total)} | ${all.parseFailures} | ${all.timeoutFailures} | ${all.failureCounts.abstain} |`);
  }
}
report.push('', 'Percent error uses absolute error divided by truth, with exact zero required for zero truth.',
  'Against zero truth, zero prediction has 0% error and any nonzero prediction has 100% error under the frozen metric.',
  'Zero correctness counts individual zero-valued macro fields, rather than whole meals.',
  'The calorie miss threshold is strictly greater than 50%, and all-four success requires each error to be at most 25%.',
  'The all-case view counts every missing estimate as infinite error and a calorie miss; its medians include these failures.',
  'The parsed-only view includes only valid complete macro predictions and uses its own case and zero-field denominators.',
  'Parse failures count malformed JSON and invalid typed fields/probability distributions; timeouts and estimator abstentions are separate.',
  repair ? 'Haiku format recovery uses a changed probability instruction only on original failed cases; this primary view still uses the unchanged strict decoder.'
    : 'Known invalid model answers remain failed outcomes in this cache-only primary view.',
  '', '## Cost and latency', '',
  '| Tier | Method | Attempted cases | New USD/1k cases | Recorded request USD/1k | Execution p95 ms | Original request-total p95 ms |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |');
for (const tier of ['curated', 'bulk', 'both']) for (const method of metadata.config.methods) {
  const p = performance[`${tier}/${method}`];
  report.push(`| ${tier} | ${method} | ${p.cases} | ${p.newCostPer1000Usd.toFixed(4)} | ${p.referenceCostPer1000Usd.toFixed(4)} | ${p.p95ExecutionMs.toFixed(1)} | ${p.p95RecordedTransportMs === null ? 'N/A' : p.p95RecordedTransportMs.toFixed(1)} |`);
}
report.push('', 'New USD/1k includes all actual bills from the initial and continuation runs, including failed answers, divided by the selected supported cases.',
  'Recorded request USD/1k sums original response usage costs for the requests consumed by those same cases, including both estimator stages and replayed inputs.',
  'It is a request-equivalent reference cost, rather than another charge or a new call to a provider.',
  'Execution p95 measures the final runner and includes replay reads.',
  'Original request-total p95 sums retained original request durations within each case, including both stages where called; it excludes current replay savings and some runner overhead.',
  'Every provider is replayed in this re-score, so execution p95 measures local replay rather than live provider latency.',
  'Retained original request timings were collected at different times and are descriptive measurements, not a controlled current latency benchmark.',
  'Exact timing covers matching only; no exact macro cost or latency is implied.',
  '', '## Spend and evidence', '',
  `Actual new inference spend: **$${state.modelKnownUsd.toFixed(8)}**, comprising Haiku **$${newCosts.haiku.toFixed(8)}** and Qwen **$${newCosts.qwen.toFixed(8)}**.`,
  'Exact and Jev add $0.',
  `Historical Jev spend remains $${preflight.ledger.knownUsd.toFixed(8)}; cumulative suite spend is $${state.knownUsd.toFixed(8)}.`,
  `The audit reconciles ${paidInputs.size} distinct paid model inputs, zero repeated paid inputs, zero new Jev requests, no pending reservations and no unknown usage.`,
  'The complete original ledger prefix is preserved.',
  'The two HTTP 400 rejections are retained with their original unknown settlements and additive zero-inference reconciliation receipts.',
  'One Qwen body timed out at 60 seconds; its output remains failed and its $0.00070390 charge is allocated from the sole unresolved request in stable same-key usage counters, within the original reservation.',
  'The before/after lifetime delta matches the daily total, and the two post-timeout reads were unchanged for 289.436 seconds.',
  'This allocation uses aggregate billing evidence; that response has no recovered token-level usage or output.',
  'A second Qwen body timed out at 180 seconds; its retained header generation ID identifies an exact $0.00080546 cancelled-generation bill with 1,054 prompt and 1,292 completion tokens.',
  'Both missing outputs remain failed, and the observed timeout durations are censored latency measurements.',
  'Later unseen Qwen inputs use a 300-second deadline at the same token/price ceiling and preserve generation IDs before body reads.',
  'The final re-score makes no inference calls; each consumed request identifies its original billed response.',
  'Cached Haiku failures have completed valid JSON with invalid probability distributions, rather than recoverable JSON syntax.',
  'The shared strict decoder rejects totals outside its original tolerance or a choice inconsistent with argmax; normalization would change the comparison.',
  'The later pre-existing continuation already attempted all 129 Qwen cases, including the previously pending nine bulk cases.',
  'Anthropic rejected the original macro grammar during schema compilation; shared internal definitions preserve the exact expanded schema and required output constraints.',
  'OpenRouter initially selected a GMICloud endpoint that rejected the model as deprecated; a same-key, same-day zero-usage read independently confirms that rejection added no charge.',
  'Qwen then uses the same model on `deepinfra/fp8`, with fallbacks disabled and the original price ceiling.',
  'This provider and quantization are comparison limitations, as are the providers\' constrained-generation transport differences from Jev.',
  'The questions, state projections, bins, targets and final decoder remain unchanged.',
  ...(repair ? ['Haiku adds a system instruction requiring probability totals of one and choice equal to argmax.',
    'Successful original answers remain cached; only the 30 original failed macro cases and three matching failures are eligible for the changed request.',
    'This targeted DEV recovery mixes original and repaired Haiku responses and does not represent a fresh independent benchmark of the new prompt.'] : []),
  'The sample is small and deterministic, spans correlated candidate pairs, and supports DEV comparison rather than holdout generalization or production adoption.',
  '',
  'Evidence: [canonical summary](summary.json), [predictions](predictions.jsonl), [bill and sample audit](comparison-audit.json), [source and selection](run.json).',
  'Provider contracts: [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenRouter routing](https://openrouter.ai/docs/guides/routing/provider-selection), [current-key usage](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key).',
  '',
);
const medians = m => ['calories', 'protein', 'carbs', 'fat'].map(k => m.medianPercentError[k] === null ? m.total ? 'inf' : 'N/A' : m.medianPercentError[k].toFixed(1)).join('/');
report.push('## Combined strict comparison', '',
  '| Method | Matching pass | Wrong matches | Recall | Macro parsed/all | Median % Cal/P/C/F parsed | Median % Cal/P/C/F all | >50% cal parsed/all | All four <=25% parsed/all |',
  '| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |');
for (const method of metadata.config.methods) {
  const { matching: m, macro: a } = aggregate[method], p = a?.parsedOnly;
  report.push(`| ${method} | ${countRate(m.passed, m.total)} | ${m.wrongMatches} | ${countRate(m.truePositives, m.positives)} | ${a ? `${p.total}/${a.total}` : 'N/A'} | ${a ? medians(p) : 'N/A'} | ${a ? medians(a) : 'N/A'} | ${a ? `${p.bigMisses}/${p.total}; ${a.bigMisses}/${a.total}` : 'N/A'} | ${a ? `${p.passed}/${p.total}; ${a.passed}/${a.total}` : 'N/A'} |`);
}
report.push('', '## Failure attribution before and after', '',
  'Wrong estimate means a parsed macro prediction with at least one error above 25%; output failures are counted separately.', '',
  '| Method / task | Before parse/format/timeout | After parse/format/timeout | Before wrong estimates | After wrong estimates |',
  '| --- | --- | --- | ---: | ---: |');
for (const method of metadata.config.methods) for (const task of ['matching', 'macro']) {
  if (method === 'exact' && task === 'macro') continue;
  const cases = selected.filter(c => c.task === task), ids = new Set(cases.map(c => c.id));
  const old = score(cases, before.filter(r => r.method === method && ids.has(r.id))), now = aggregate[method][task];
  const failures = m => `${m.failureCounts.parse}/${m.failureCounts.format}/${m.failureCounts.timeout}`;
  report.push(`| ${method}/${task} | ${failures(old)} | ${failures(now)} | ${task === 'macro' ? old.parsedOnly.total - old.parsedOnly.passed : 'N/A'} | ${task === 'macro' ? now.parsedOnly.total - now.parsedOnly.passed : 'N/A'} |`);
}
if (repair) {
  const normResults = lines(path.join(base, 'haiku-format-preflight/normalized-predictions.jsonl'));
  const match = score(selected.filter(c => c.task === 'matching'), normResults.filter(r => selected.find(c => c.id === r.id).task === 'matching'));
  const macro = score(selected.filter(c => c.task === 'macro'), normResults.filter(r => selected.find(c => c.id === r.id).task === 'macro'));
  report.push('', '## SECONDARY: normalized original cache only', '',
    'This diagnostic renormalizes original Haiku vectors and selects their exact maximum, using no repaired responses or live calls.',
    'It changes the answer contract and is excluded from the strict comparison above.',
    `${normalized.cacheMissCases.length} cases require an absent refinement after coarse argmax changes; they remain cache failures, without invented estimates.`, '',
    '| Method / view | Matching pass | Wrong matches | Recall | Macro parsed/all | Median % Cal/P/C/F parsed | Median % Cal/P/C/F all | >50% cal parsed/all | All four <=25% parsed/all |',
    '| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
    `| Haiku normalized original cache | ${countRate(match.passed, match.total)} | ${match.wrongMatches} | ${countRate(match.truePositives, match.positives)} | ${macro.parsedOnly.total}/${macro.total} | ${medians(macro.parsedOnly)} | ${medians(macro)} | ${macro.parsedOnly.bigMisses}/${macro.parsedOnly.total}; ${macro.bigMisses}/${macro.total} | ${macro.parsedOnly.passed}/${macro.parsedOnly.total}; ${macro.passed}/${macro.total} |`, '',
    `This repair adds ${reparse.newRequests} distinct changed-payload requests for $${reparse.newSpendUsd.toFixed(8)}.`,
    `The ledger totals $${state.knownUsd.toFixed(8)}, including all historical Jev, Haiku and Qwen bills.`, '');
}
fs.writeFileSync(path.join(out, 'comparison-report.md'), report.join('\n'), { flag: 'wx' });
console.log(JSON.stringify({ runId, newCosts, newRepairSpendUsd: reparse.newSpendUsd, actualNewSpendUsd: audit.actualNewSpendUsd, paidModelRequests: audit.paidModelRequests,
  duplicatePaidInputs: 0, newJevRequests: 0, rejectedRequests: rejectedRequests.length, recoveredCases, aggregate }, null, 2));
