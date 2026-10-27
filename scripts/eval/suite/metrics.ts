import { macroNames, type Case, type Macros, type MatchOutput, type Result } from './types';

export const percentError = (actual: number, expected: number) => expected === 0 ? actual === 0 ? 0 : 100 : Math.abs(actual - expected) / expected * 100;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  const value = n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : NaN;
  return Number.isFinite(value) ? value : null;
};
const divide = (a: number, b: number) => b ? a / b : null;
function summarize(cases: Case[], results: Result[]) {
  const byId = new Map(results.map(r => [r.id, r]));
  if (byId.size !== results.length || results.some(r => !cases.some(c => c.id === r.id))) throw new Error('Duplicate or foreign result ID');
  const categories: Record<string, { passed: number; total: number; passRate: number }> = {};
  let passed = 0, wrongMatches = 0, positives = 0, tp = 0, abstentions = 0, bigMisses = 0, zeroTotal = 0, zeroCorrect = 0;
  const errors: Record<keyof Macros, number[]> = { calories: [], protein: [], carbs: [], fat: [] };
  const parsedErrors: Record<keyof Macros, number[]> = { calories: [], protein: [], carbs: [], fat: [] };
  const failureCounts = { parse: 0, format: 0, timeout: 0, abstain: 0, adapter: 0, missing: 0 };
  let parsed = 0, parsedPassed = 0, parsedBigMisses = 0, parsedZeroTotal = 0, parsedZeroCorrect = 0;
  for (const c of cases) {
    const result = byId.get(c.id), output = result?.failure ? null : result?.output;
    if (!result) failureCounts.missing++;
    else if (result.failure || !output) failureCounts[result.failureKind ?? 'adapter']++;
    let pass = false;
    if (c.task === 'matching') {
      const decision = output as MatchOutput | null;
      positives += Number(c.expected.kind === 'match');
      if (!decision || decision.kind === 'abstain') abstentions++;
      if (decision?.kind === 'match' && decision.matchId !== c.expected.matchId) wrongMatches++;
      pass = Boolean(decision && decision.kind === c.expected.kind && decision.matchId === c.expected.matchId);
      tp += Number(pass && c.expected.kind === 'match');
    } else {
      const prediction = output as Macros | null;
      const e = macroNames.map(macro => prediction ? percentError(prediction[macro], c.expected[macro]) : Infinity);
      macroNames.forEach((macro, i) => {
        errors[macro].push(e[i]!);
        if (c.expected[macro] === 0) { zeroTotal++; zeroCorrect += Number(prediction?.[macro] === 0); }
      });
      bigMisses += Number(e[0]! > 50);
      pass = e.every(value => value <= 25);
      if (prediction) {
        parsed++; parsedPassed += Number(pass); parsedBigMisses += Number(e[0]! > 50);
        macroNames.forEach((macro, i) => {
          parsedErrors[macro].push(e[i]!);
          if (c.expected[macro] === 0) { parsedZeroTotal++; parsedZeroCorrect += Number(prediction[macro] === 0); }
        });
      }
    }
    passed += Number(pass);
    const category = categories[c.category] ??= { passed: 0, total: 0, passRate: 0 };
    category.total++; category.passed += Number(pass); category.passRate = category.passed / category.total;
  }
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const matching = cases.filter(c => c.task === 'matching').length, macros = cases.length - matching;
  const knownCostUsd = results.reduce((sum, r) => sum + (r.knownCostUsd ?? r.costUsd ?? 0), 0);
  return { total: cases.length, attempted: results.length, missing: cases.length - results.length, passed,
    failureCounts, parseFailures: failureCounts.parse + failureCounts.format, timeoutFailures: failureCounts.timeout,
    parsedOnly: macros ? { total: parsed, passed: parsedPassed, passRate: divide(parsedPassed, parsed),
      medianPercentError: Object.fromEntries(macroNames.map(m => [m, median(parsedErrors[m])])) as Record<keyof Macros, number | null>,
      bigMisses: parsedBigMisses, bigMissRate: divide(parsedBigMisses, parsed),
      zeroCorrect: parsedZeroCorrect, zeroTotal: parsedZeroTotal, zeroCorrectness: divide(parsedZeroCorrect, parsedZeroTotal) } : null,
    passRate: divide(passed, cases.length), categories, wrongMatches: matching ? wrongMatches : null,
    recall: matching ? divide(tp, positives) : null, positives, truePositives: tp, abstentions: matching ? abstentions : null,
    medianPercentError: macros ? Object.fromEntries(macroNames.map(m => [m, median(errors[m])])) as Record<keyof Macros, number | null> : null,
    bigMisses: macros ? bigMisses : null, bigMissRate: macros ? divide(bigMisses, macros) : null,
    zeroCorrectness: macros ? divide(zeroCorrect, zeroTotal) : null, zeroCorrect, zeroTotal,
    knownCostUsd, costUsd: results.some(r => r.costUsd === null) ? null : knownCostUsd,
    costPer1000Usd: results.some(r => r.costUsd === null) ? null : divide(knownCostUsd * 1000, results.length),
    p95LatencyMs: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? null };
}
export function score(cases: Case[], results: Result[]) {
  const overall = summarize(cases, results);
  const chains = Object.fromEntries([...new Set(cases.map(c => c.chain))].sort().map(chain => {
    const selected = cases.filter(c => c.chain === chain), ids = new Set(selected.map(c => c.id));
    return [chain, summarize(selected, results.filter(r => ids.has(r.id)))];
  }));
  return { ...overall, chains };
}
export type Metrics = ReturnType<typeof score>;
const pct = (n: number | null | undefined) => n === null || n === undefined ? '-' : `${(n * 100).toFixed(1)}%`;
const metricHeader = (label: string) => [
  `| ${label} | N (attempted) | Pass / all four <=25% | Wrong match | Recall | Abstain | Median % error Cal/P/C/F (all) | >50% cal | Zero correct | Parse/format | Timeout | $/1k | p95 ms |`,
  '| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
const metricRow = (name: string, m: ReturnType<typeof summarize>) => `| ${name} | ${m.total} (${m.attempted}) | ${pct(m.passRate)} | ${m.wrongMatches ?? '-'} | ${pct(m.recall)} | ${m.abstentions ?? '-'} | ${m.medianPercentError ? macroNames.map(k => m.medianPercentError![k]?.toFixed(1) ?? (m.total ? 'infinity' : '-')).join('/') : '-'} | ${pct(m.bigMissRate)} | ${pct(m.zeroCorrectness)} | ${m.parseFailures} | ${m.timeoutFailures} | ${m.costPer1000Usd?.toFixed(4) ?? '-'} | ${m.p95LatencyMs?.toFixed(1) ?? '-'} |`;
export function chainTable(scores: Record<string, Metrics>) {
  const lines = metricHeader('Tier / task / method / chain');
  for (const [name, m] of Object.entries(scores)) {
    for (const [chain, measured] of Object.entries(m.chains)) lines.push(metricRow(`${name} / ${chain}`, measured));
  }
  return lines.join('\n') + '\n';
}
export function table(scores: Record<string, Metrics>) {
  const lines = metricHeader('Tier / task / method');
  for (const [name, m] of Object.entries(scores)) lines.push(metricRow(name, m));
  lines.push('', chainTable(scores));
  lines.push('', '| Tier / macro / method (parsed only) | Parsed / all | Median % error Cal/P/C/F | >50% cal | Zero correct | All four <=25% |',
    '| --- | ---: | --- | ---: | ---: | ---: |');
  for (const [name, m] of Object.entries(scores)) {
    const p = m.parsedOnly;
    if (p) lines.push(`| ${name} | ${p.total}/${m.total} | ${macroNames.map(k => p.medianPercentError[k]?.toFixed(1) ?? '-').join('/')} | ${pct(p.bigMissRate)} | ${pct(p.zeroCorrectness)} | ${pct(p.passRate)} |`);
  }
  lines.push('', '| Tier / task / category | ' + Object.keys(scores).join(' | ') + ' |', '| --- | ' + Object.keys(scores).map(() => '---:').join(' | ') + ' |');
  for (const category of [...new Set(Object.values(scores).flatMap(m => Object.keys(m.categories)))].sort()) lines.push(`| ${category} | ${Object.values(scores).map(m => m.categories[category] ? `${pct(m.categories[category]!.passRate)} (${m.categories[category]!.passed}/${m.categories[category]!.total})` : '-').join(' | ')} |`);
  return lines.join('\n') + '\n';
}
